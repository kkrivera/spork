class Spork < Formula
  desc "Manage git-worktree-based workspaces spanning multiple independent repos"
  homepage "https://github.com/kkrivera/spork"
  version "1.0.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/kkrivera/spork/releases/download/v1.0.0/spork-1.0.0-darwin-arm64.tar.gz"
      sha256 "759a11b762b493d0c8a4ee24d0ac20fd7d34221c911d33421ea8aff68f7fa2be"
    end
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v1.0.0/spork-1.0.0-darwin-x64.tar.gz"
      sha256 "b5ebe9e5ca61d297dded4694d61e3d2d55704f5cade012f5b28714971f1f430a"
    end
  end

  on_linux do
    on_intel do
      url "https://github.com/kkrivera/spork/releases/download/v1.0.0/spork-1.0.0-linux-x64.tar.gz"
      sha256 "cced9f1320cd4554affe4d784f4f9ad20a550e889af2fecea4887bb41e92e4d8"
    end
  end

  def install
    bin.install "spork"
  end

  test do
    assert_match "Manage git-worktree-based workspaces", shell_output("#{bin}/spork --help")
  end
end
