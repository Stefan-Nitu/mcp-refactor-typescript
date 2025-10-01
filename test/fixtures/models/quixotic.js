// Test rename: rename this constant across files
export const QUIXOTIC_DEFAULT_PRICE = 777.77;
export class QuixoticModel {
    id;
    quixoticName;
    quixoticPrice;
    isQuixotic;
    constructor(data) {
        this.id = data.id || '';
        this.quixoticName = data.quixoticName || '';
        this.quixoticPrice = data.quixoticPrice || QUIXOTIC_DEFAULT_PRICE;
        this.isQuixotic = data.isQuixotic ?? true;
    }
    // Test extract method: this logic could be extracted
    applyQuixoticDiscount(discountPercent) {
        const discountAmount = this.quixoticPrice * (discountPercent / 100);
        const newPrice = this.quixoticPrice - discountAmount;
        const roundedPrice = Math.round(newPrice * 100) / 100;
        return roundedPrice;
    }
}
