import { User } from './models/user.js';

export class UserService {
  getDisplayName(user: User): string {
    return user.getName().toUpperCase();
  }
}
