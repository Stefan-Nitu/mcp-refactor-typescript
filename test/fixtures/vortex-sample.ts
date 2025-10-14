// Vortex sample TypeScript file for testing refactoring operations


// Test rename: rename this variable
const renamedVortexQuantum = 42;

// Test organize imports: unused imports above (fs)

class VortexManager {
  private vortexLabel: string;
  private vortexIntensity: number;

  constructor(label: string, intensity: number) {
    this.vortexLabel = label;
    this.vortexIntensity = intensity;
  }

  // Test extract function: select lines 22-25 and extract
  getVortexDetails() {
    const details = `Label: ${this.vortexLabel}, Intensity: ${this.vortexIntensity}`;
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] Vortex: ${details}`;
    console.log(logEntry);
    return details;
  }

  // Test extract variable: select the expression inside
  calculateVortexPower(baseValue: number) {
    return baseValue * 0.9 * (1 - 0.1);
  }
}

// Test fix all: missing type annotation
function processVortexData(vortexArray: number[]): number[] {
  return vortexArray.map(vortex => vortex * 2);
}

// Test remove unused: this function is never called
function unusedVortexOperation() {
  console.log('This vortex operation is never used');
}

// Using the variable to test rename
console.log(renamedVortexQuantum);

export { VortexManager };
