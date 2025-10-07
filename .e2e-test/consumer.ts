import { Person, processUser } from './types.js';

const user: Person = { name: 'Alice', age: 30 };
console.log(processUser(user));
