export class User {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  getFullName(): string {
    return this.name;
  }
}
