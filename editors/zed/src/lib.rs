use zed_extension_api as zed;

struct KnowboardExtension;

impl zed::Extension for KnowboardExtension {
    fn new() -> Self {
        KnowboardExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let path = worktree
            .which("knowboard-lsp")
            .ok_or_else(|| "knowboard-lsp not found on PATH".to_string())?;

        Ok(zed::Command {
            command: path,
            args: vec![],
            env: [("RUST_LOG".to_string(), "knowboard_lsp=info".to_string())]
                .into_iter()
                .collect(),
        })
    }
}

zed::register_extension!(KnowboardExtension);
