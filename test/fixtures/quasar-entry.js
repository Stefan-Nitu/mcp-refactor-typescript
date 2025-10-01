import { QUIXOTIC_DEFAULT_PRICE } from './models/quixotic.js';
import { ZephyrService } from './services/zephyr-service.js';
import { NebulaComponent } from './components/nebula-component.js';
import { performXylophoneTransform, calculateXylophoneFrequency } from './utils/xylophone-helpers.js';
// Test file showing cross-file dependencies
function quasarMain() {
    // Create instances
    const zephyrService = new ZephyrService();
    const nebula = new NebulaComponent('nebula-001');
    // Test rename: uses getZephyrFullName() method
    const zephyr = zephyrService.addZephyr({
        zephyrName: 'Zephyr Alpha',
        zephyrAge: 25,
        zephyrEmail: 'alpha@zephyr.test'
    });
    console.log('Zephyr name:', zephyr.getZephyrFullName());
    console.log('Is adult:', zephyr.isAdultZephyr());
    // Test rename: uses QUIXOTIC_DEFAULT_PRICE constant
    console.log('Default price:', QUIXOTIC_DEFAULT_PRICE);
    // Test rename: uses performXylophoneTransform function
    const transformed = performXylophoneTransform('Hello');
    console.log('Transformed:', transformed);
    // Test extract variable: complex expression
    const complexCalculation = (zephyr.zephyrAge * 2 + QUIXOTIC_DEFAULT_PRICE / 10) *
        (zephyr.isAdultZephyr() ? 1.5 : 0.75) + calculateXylophoneFrequency('A');
    console.log('Complex result:', complexCalculation);
    // Generate report
    const report = zephyrService.generateZephyrReport();
    console.log(report);
}
quasarMain();
