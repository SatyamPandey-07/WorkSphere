import { venueRatingSchema } from '@/lib/validations';

describe('Validations - venueRatingSchema', () => {
  it('should validate venue rating with valid outletLocations array', () => {
    const validData = {
      wifiQuality: 4,
      hasOutlets: true,
      powerTypes: ['ac_wall', 'usb_c'],
      outletLocations: ['under_tables', 'wall_mounted'],
      noiseLevel: 'quiet' as const,
      comment: 'Excellent spot for working!',
      hasErgonomic: true,
      outletDensity: 'every_table' as const,
    };

    const result = venueRatingSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outletLocations).toEqual(['under_tables', 'wall_mounted']);
    }
  });

  it('should validate venue rating when outletLocations is omitted', () => {
    const dataWithoutLocations = {
      wifiQuality: 3,
      hasOutlets: false,
      noiseLevel: 'moderate' as const,
      hasErgonomic: false,
      outletDensity: 'none' as const,
    };

    const result = venueRatingSchema.safeParse(dataWithoutLocations);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.outletLocations).toBeUndefined();
    }
  });

  it('should fail validation when outletLocations is not an array of strings', () => {
    const invalidData = {
      wifiQuality: 3,
      hasOutlets: true,
      outletLocations: 'under_tables', // should be an array
      noiseLevel: 'moderate' as const,
    };

    const result = venueRatingSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });
});
