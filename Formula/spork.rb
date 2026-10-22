class Spork < Formula
  desc "Manage git-worktree-based workspaces spanning multiple independent repos"
  homepage "https://github.com/kkrivera/spork"
  version "1.0.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/kkrivera/spork/releases/download/v1.0.0/spork-1.0.0-darwin-arm64.tar.gz"
      sha256 "759a11b762b493d0c8a4ee24d0ac20fd7d34221c911d33421ea8aff68f7fa2be"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.0.0/spork-mcp-1.0.0-darwin-arm64.tar.gz"
        sha256 "31f0de83ddc03c16987528fb4691fbddb18038c9c2c8d874628e72da5a079b30"
      end
    end
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v1.0.0/spork-1.0.0-darwin-x64.tar.gz"
      sha256 "b5ebe9e5ca61d297dded4694d61e3d2d55704f5cade012f5b28714971f1f430a"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.0.0/spork-mcp-1.0.0-darwin-x64.tar.gz"
        sha256 "d9f96db89437276fd891afb3e63b563aab63533fe445d77932c640485680f797"
      end
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v1.0.0/spork-1.0.0-linux-x64.tar.gz"
      sha256 "cced9f1320cd4554affe4d784f4f9ad20a550e889af2fecea4887bb41e92e4d8"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.0.0/spork-mcp-1.0.0-linux-x64.tar.gz"
        sha256 "f554892fd14e18968e48710092d791dae176cb4254b7c755a89e203cb42757e3"
      end
    end
  end

  # spork-mcp ships alongside spork (same release, same version) so one
  # `brew upgrade spork` keeps both current; it's the MCP server an agent
  # launches, e.g. `claude mcp add spork -- "$(brew --prefix)/bin/spork-mcp"`.
  def install
    bin.install "spork"
    resource("spork-mcp").stage { bin.install "spork-mcp" }
  end

  test do
    assert_match "Manage git-worktree-based workspaces", shell_output("#{bin}/spork --help")
    # spork-mcp is a stdio server that waits for a client, so just check it was installed.
    assert_predicate bin/"spork-mcp", :executable?
  end
end
