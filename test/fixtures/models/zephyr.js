export class ZephyrModel {
    id;
    zephyrName;
    zephyrEmail;
    zephyrAge;
    zephyrCreatedAt;
    constructor(data) {
        this.id = data.id || '';
        this.zephyrName = data.zephyrName || '';
        this.zephyrEmail = data.zephyrEmail || '';
        this.zephyrAge = data.zephyrAge || 0;
        this.zephyrCreatedAt = data.zephyrCreatedAt || new Date();
    }
    // Test rename: rename this method across all files
    getZephyrFullName() {
        return this.zephyrName;
    }
    isAdultZephyr() {
        return this.zephyrAge >= 18;
    }
}
