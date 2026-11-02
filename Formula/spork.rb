class Spork < Formula
  desc "Manage git-worktree-based workspaces spanning multiple independent repos"
  homepage "https://github.com/kkrivera/spork"
  version "1.2.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/kkrivera/spork/releases/download/v1.2.0/spork-1.2.0-darwin-arm64.tar.gz"
      sha256 "d05feca77b9c6f74410b7225332905c3fd0f9b634d46686f47d5550f0c83c0e7"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.2.0/spork-mcp-1.2.0-darwin-arm64.tar.gz"
        sha256 "05d5166186a1b1bfcf1477dd2d04bacafa2e1d0fa5bbbe065229018157959878"
      end
    end
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v1.2.0/spork-1.2.0-darwin-x64.tar.gz"
      sha256 "d1c478d8c7dbf79016e67748edb5cd8f71ca61e5c1e8a7c888bb3dcbee59e470"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.2.0/spork-mcp-1.2.0-darwin-x64.tar.gz"
        sha256 "475b5d501d6f5ea93ff985f0e869547b4252e6274de8c55803f86e8cf7a65f41"
      end
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v1.2.0/spork-1.2.0-linux-x64.tar.gz"
      sha256 "21b78ed7c33c0653f24946558fadbedfa5bc2be82c1988c56e92397410053fdf"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.2.0/spork-mcp-1.2.0-linux-x64.tar.gz"
        sha256 "b826eb99953ecb7d67c84f437f67cb0345d25dd13a4ccde905987384483433bf"
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
