class Spork < Formula
  desc "Manage git-worktree-based workspaces spanning multiple independent repos"
  homepage "https://github.com/kkrivera/spork"
  version "1.3.3"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/kkrivera/spork/releases/download/v1.3.3/spork-1.3.3-darwin-arm64.tar.gz"
      sha256 "875c6520db71b16fd54ca026c7100c989a62f1b75a962c79265d89dbde2b6f57"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.3.3/spork-mcp-1.3.3-darwin-arm64.tar.gz"
        sha256 "d101860972bb7d7147178e3c27565c431c6ac6d0712b95cacc2349d3c1dce5d1"
      end
    end
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v1.3.3/spork-1.3.3-darwin-x64.tar.gz"
      sha256 "4867b30458c383f73c0cff970b132be37fa231e849b26fcf85530238223d41c5"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.3.3/spork-mcp-1.3.3-darwin-x64.tar.gz"
        sha256 "305c4f93db6effb7ead0ef0891c9618fa619d699ba2d29ac0804189140099236"
      end
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v1.3.3/spork-1.3.3-linux-x64.tar.gz"
      sha256 "ff9456291d2ab9be5b79a4c55c9e3669c0ae8effdf3fa78e3642ffd5df350397"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.3.3/spork-mcp-1.3.3-linux-x64.tar.gz"
        sha256 "d0e5bfbc52d002dc73c6b673e76b422a2ad1c6e4a7ca3065b43a2e126114dec1"
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
