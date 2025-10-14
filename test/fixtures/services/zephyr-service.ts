import { QUIXOTIC_DEFAULT_PRICE } from '../models/quixotic.js';
import { Zephyr, ZephyrModel } from '../models/zephyr.js';

export class ZephyrService {
  private zephyrs: ZephyrModel[] = [];

  // Test rename: this method uses ZephyrModel.getZephyrDisplayName()
  addZephyr(data: Partial<Zephyr>): ZephyrModel {
    const newZephyr = new ZephyrModel(data);
    this.zephyrs.push(newZephyr);

    // Using the method that will be renamed
    console.log('Added zephyr:', newZephyr.getZephyrDisplayName());

    return newZephyr;
  }

  // Test extract variable: complex expression
  calculateZephyrScore(zephyr: ZephyrModel): number {
    return (zephyr.zephyrAge * 2 + QUIXOTIC_DEFAULT_PRICE / 10) * (zephyr.isAdultZephyr() ? 1.5 : 0.75);
  }

  findAdultZephyrs(): ZephyrModel[] {
    return this.zephyrs.filter(z => z.isAdultZephyr());
  }

  // Test extract function: this block could be extracted
  generateZephyrReport(): string {
    let report = 'Zephyr Report\n';
    report += '=============\n';
    for (const zephyr of this.zephyrs) {
      report += `Name: ${zephyr.getZephyrDisplayName()}\n`;
      report += `Age: ${zephyr.zephyrAge}\n`;
      report += `Adult: ${zephyr.isAdultZephyr() ? 'Yes' : 'No'}\n`;
      report += '---\n';
    }
    return report;
  }
}