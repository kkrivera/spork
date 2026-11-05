class Spork < Formula
  desc "Manage git-worktree-based workspaces spanning multiple independent repos"
  homepage "https://github.com/kkrivera/spork"
  version "1.3.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/kkrivera/spork/releases/download/v1.3.0/spork-1.3.0-darwin-arm64.tar.gz"
      sha256 "e9e45a0d2fac00b8b6fa1eae71f03be82f040facbe01b2f1197485c3ea7932b2"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.3.0/spork-mcp-1.3.0-darwin-arm64.tar.gz"
        sha256 "a164e2f82c1e590cc9a87ca28d50dd6769eae272c4f9f089afa11d7125b900af"
      end
    end
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v1.3.0/spork-1.3.0-darwin-x64.tar.gz"
      sha256 "5e5d4bd38fdd3a8c3e5fedea4da62f6b531a38b3f29523ff585fd9b51141f39a"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.3.0/spork-mcp-1.3.0-darwin-x64.tar.gz"
        sha256 "34c35e4f73e15c00afbc7fbe7fb753e006768b6db871ac62e79bf32ec63455c1"
      end
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v1.3.0/spork-1.3.0-linux-x64.tar.gz"
      sha256 "4de86b791d3f26f68e9573a88703095f6978e852332f549434a12ffb3defdcaf"

      resource "spork-mcp" do
        url "https://github.com/kkrivera/spork/releases/download/v1.3.0/spork-mcp-1.3.0-linux-x64.tar.gz"
        sha256 "5231763b916152b7fb03fe8e1171e83987469cf8265c9fbd53c697dcae84896a"
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
