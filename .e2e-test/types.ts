export interface Person {
  name: string;
  age: number;
}

export function processUser(user: Person): string {
  return user.name;
}
