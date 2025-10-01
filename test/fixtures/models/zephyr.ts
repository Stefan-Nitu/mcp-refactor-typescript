export interface Zephyr {
  id: string;
  zephyrName: string;
  zephyrEmail: string;
  zephyrAge: number;
  zephyrCreatedAt: Date;
}

export class ZephyrModel implements Zephyr {
  id: string;
  zephyrName: string;
  zephyrEmail: string;
  zephyrAge: number;
  zephyrCreatedAt: Date;

  constructor(data: Partial<Zephyr>) {
    this.id = data.id || '';
    this.zephyrName = data.zephyrName || '';
    this.zephyrEmail = data.zephyrEmail || '';
    this.zephyrAge = data.zephyrAge || 0;
    this.zephyrCreatedAt = data.zephyrCreatedAt || new Date();
  }

  // Test rename: rename this method across all files
  getZephyrDisplayName(): string {
    return this.zephyrName;
  }

  isAdultZephyr(): boolean {
    return this.zephyrAge >= 18;
  }
}