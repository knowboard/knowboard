use std::path::Path;
use zed_extension_api as zed;

const EXTENSION_VERSION: &str = env!("CARGO_PKG_VERSION");
const REPO: &str = "knowboard/knowboard";
const SERVER_NAME: &str = "knowboard-lsp";

struct KnowboardExtension;

impl KnowboardExtension {
    /// Returns the Rust target triple for the current platform, if supported.
    fn target_triple(os: zed::Os, arch: zed::Architecture) -> Option<&'static str> {
        match (os, arch) {
            (zed::Os::Mac, zed::Architecture::Aarch64) => Some("aarch64-apple-darwin"),
            (zed::Os::Mac, zed::Architecture::X8664) => Some("x86_64-apple-darwin"),
            (zed::Os::Linux, zed::Architecture::Aarch64) => Some("aarch64-unknown-linux-gnu"),
            (zed::Os::Linux, zed::Architecture::X8664) => Some("x86_64-unknown-linux-gnu"),
            (zed::Os::Windows, zed::Architecture::X8664) => Some("x86_64-pc-windows-msvc"),
            (zed::Os::Windows, zed::Architecture::Aarch64) => Some("aarch64-pc-windows-msvc"),
            _ => None,
        }
    }

    /// Path to the extracted binary, versioned so updates trigger a re-download.
    fn cached_binary_path(target: &str, version: &str) -> String {
        let name = if target.contains("windows") {
            "knowboard-lsp.exe"
        } else {
            "knowboard-lsp"
        };
        format!("lsp-bin/{version}/{target}/{name}")
    }

    /// Asset name on the GitHub release.
    fn asset_name(target: &str) -> String {
        format!("knowboard-lsp-{target}.tar.gz")
    }

    /// Resolve the path to the knowboard-lsp binary, downloading it
    /// if necessary.
    fn resolve_server_path(
        &self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<String> {
        // If a server is already on the PATH, prefer that over downloading
        if let Some(path) = worktree.which(SERVER_NAME) {
            return Ok(path);
        }

        let (os, arch) = zed::current_platform();
        let target = Self::target_triple(os, arch).ok_or_else(|| {
            let msg = format!("unsupported platform: {os:?} {arch:?}");
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Failed(msg.clone()),
            );
            msg
        })?;

        let bin_path = Self::cached_binary_path(target, EXTENSION_VERSION);

        if Path::new(&bin_path).exists() {
            return Ok(bin_path);
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::Downloading,
        );

        let release_tag = format!("v{EXTENSION_VERSION}");
        let release = zed::github_release_by_tag_name(REPO, &release_tag).map_err(|e| {
            let msg = format!("failed to fetch release {release_tag}: {e}");
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Failed(msg.clone()),
            );
            msg
        })?;

        let asset_name = Self::asset_name(target);
        let asset = release
            .assets
            .iter()
            .find(|a| a.name == asset_name)
            .ok_or_else(|| {
                let msg = format!("asset not found: {asset_name}");
                zed::set_language_server_installation_status(
                    language_server_id,
                    &zed::LanguageServerInstallationStatus::Failed(msg.clone()),
                );
                msg
            })?;

        let extract_dir = format!("lsp-bin/{EXTENSION_VERSION}/{target}/.extract");
        zed::download_file(
            &asset.download_url,
            &extract_dir,
            zed::DownloadedFileType::GzipTar,
        )
        .map_err(|e| {
            let msg = format!("download failed: {e}");
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Failed(msg.clone()),
            );
            msg
        })?;

        std::fs::rename(&format!("{extract_dir}/knowboard-lsp"), &bin_path).map_err(|e| {
            let msg = format!("failed to move binary: {e}");
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Failed(msg.clone()),
            );
            msg
        })?;

        let _ = std::fs::remove_dir_all(&extract_dir);

        zed::make_file_executable(&bin_path).map_err(|e| {
            let msg = format!("failed to make binary executable: {e}");
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Failed(msg.clone()),
            );
            msg
        })?;

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::None,
        );

        Ok(bin_path)
    }
}

impl zed::Extension for KnowboardExtension {
    fn new() -> Self {
        KnowboardExtension
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let path = self.resolve_server_path(language_server_id, worktree)?;
        Ok(zed::Command {
            command: path,
            args: vec![],
            env: vec![("RUST_LOG".to_string(), "knowboard_lsp=info".to_string())],
        })
    }
}

zed::register_extension!(KnowboardExtension);
