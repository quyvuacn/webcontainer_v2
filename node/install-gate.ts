class InstallGate {
  begin(): void {}
  done(): void {}
  async wait(): Promise<void> {}
}

export const installGate = new InstallGate()
