export class User {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  getName(): string {
    return this.name;
  }
}
