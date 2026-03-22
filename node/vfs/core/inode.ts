export interface Stats {
  ino: number;
  size: number;
  mode: number;
  atime: Date;
  mtime: Date;
  ctime: Date;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}
