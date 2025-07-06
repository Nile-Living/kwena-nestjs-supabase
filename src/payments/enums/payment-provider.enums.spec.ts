import { PaymentProvider } from './payment-provider.enums';

describe('PaymentProvider', () => {
  it('should only contain LENCO provider', () => {
    const providers = Object.values(PaymentProvider);
    
    expect(providers).toEqual(['LENCO']);
    expect(providers).toHaveLength(1);
  });

  it('should have LENCO as the only available provider', () => {
    expect(PaymentProvider.LENCO).toBe('LENCO');
    expect(PaymentProvider.LENCO).toBeDefined();
  });

  it('should not contain ZYNLE provider', () => {
    // Verify that ZYNLE is not present in the enum
    expect((PaymentProvider as any).ZYNLE).toBeUndefined();
  });

  it('should be usable in switch statements', () => {
    const provider = PaymentProvider.LENCO;
    let result: string;

    switch (provider) {
      case PaymentProvider.LENCO:
        result = 'Lenco payment provider';
        break;
      default:
        result = 'Unknown provider';
    }

    expect(result).toBe('Lenco payment provider');
  });
});