import { ZephyrModel } from '../models/zephyr.js';
import { QUIXOTIC_DEFAULT_PRICE } from '../models/quixotic.js';
export class ZephyrService {
    zephyrs = [];
    // Test rename: this method uses ZephyrModel.getZephyrFullName()
    addZephyr(data) {
        const newZephyr = new ZephyrModel(data);
        this.zephyrs.push(newZephyr);
        // Using the method that will be renamed
        console.log('Added zephyr:', newZephyr.getZephyrFullName());
        return newZephyr;
    }
    // Test extract variable: complex expression
    calculateZephyrScore(zephyr) {
        return (zephyr.zephyrAge * 2 + QUIXOTIC_DEFAULT_PRICE / 10) * (zephyr.isAdultZephyr() ? 1.5 : 0.75);
    }
    findAdultZephyrs() {
        return this.zephyrs.filter(z => z.isAdultZephyr());
    }
    // Test extract function: this block could be extracted
    generateZephyrReport() {
        let report = 'Zephyr Report\n';
        report += '=============\n';
        for (const zephyr of this.zephyrs) {
            report += `Name: ${zephyr.getZephyrFullName()}\n`;
            report += `Age: ${zephyr.zephyrAge}\n`;
            report += `Adult: ${zephyr.isAdultZephyr() ? 'Yes' : 'No'}\n`;
            report += '---\n';
        }
        return report;
    }
}
