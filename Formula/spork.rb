class Spork < Formula
  desc "Manage git-worktree-based workspaces spanning multiple independent repos"
  homepage "https://github.com/kkrivera/spork"
  version "0.0.0-unreleased"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/kkrivera/spork/releases/download/v0.0.0-unreleased/spork-0.0.0-unreleased-darwin-arm64.tar.gz"
      sha256 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    end
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v0.0.0-unreleased/spork-0.0.0-unreleased-darwin-x64.tar.gz"
      sha256 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v0.0.0-unreleased/spork-0.0.0-unreleased-linux-x64.tar.gz"
      sha256 "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    end
  end

  def install
    bin.install "spork"
  end

  test do
    assert_match "Manage git-worktree-based workspaces", shell_output("#{bin}/spork --help")
  end
end
