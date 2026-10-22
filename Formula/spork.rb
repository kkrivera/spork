class Spork < Formula
  desc "Manage git-worktree-based workspaces spanning multiple independent repos"
  homepage "https://github.com/kkrivera/spork"
  version "1.1.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/kkrivera/spork/releases/download/v1.1.0/spork-1.1.0-darwin-arm64.tar.gz"
      sha256 "7a1eabac54c806dda467c7476bebd61e6326c3d9c1f6250537d73ce2ccbc9427"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.1.0/spork-mcp-1.1.0-darwin-arm64.tar.gz"
        sha256 "0ef0f7f9b217046268e0bc5440536f821f029741768abf2edd401e5dfeeffb16"
      end
    end
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v1.1.0/spork-1.1.0-darwin-x64.tar.gz"
      sha256 "4228c627ce4ed00eecb957a31b34c6cf02c64d9970ed76391f3647f1663e367a"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.1.0/spork-mcp-1.1.0-darwin-x64.tar.gz"
        sha256 "072603ba738ae7e984971a15ac9119c1cdc1e152fc85c89c1ce4df57ecb06918"
      end
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v1.1.0/spork-1.1.0-linux-x64.tar.gz"
      sha256 "cb0b7bf01eb85402d404f9b33d65f7bebfb1e7f3307c390897e7f7687eeb071d"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.1.0/spork-mcp-1.1.0-linux-x64.tar.gz"
        sha256 "f36b6345d3f78524f14da0fc534b9e3bd160f28c9afd8894821bbd3a87fa29fa"
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
