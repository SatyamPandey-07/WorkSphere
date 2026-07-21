import { venueRatingSchema, createFolderSchema, updateFolderSchema } from '@/lib/validations';

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

describe('Validations - createFolderSchema & updateFolderSchema', () => {
  it('should accept valid folder names and trim whitespace', () => {
    const validData = {
      name: '  My Workspace Collection  ',
      description: '  A curated list of cafes  ',
      isPublic: true,
    };

    const result = createFolderSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My Workspace Collection');
      expect(result.data.description).toBe('A curated list of cafes');
      expect(result.data.isPublic).toBe(true);
    }
  });

  it('should fail validation when folder name is empty', () => {
    const emptyNameData = {
      name: '',
    };

    const result = createFolderSchema.safeParse(emptyNameData);
    expect(result.success).toBe(false);
  });

  it('should fail validation when folder name is whitespace only (preventing empty folder creation)', () => {
    const whitespaceNameData = {
      name: '     \n\t  ',
    };

    const result = createFolderSchema.safeParse(whitespaceNameData);
    expect(result.success).toBe(false);
  });

  it('should fail validation when folder name exceeds 100 characters', () => {
    const longNameData = {
      name: 'a'.repeat(101),
    };

    const result = createFolderSchema.safeParse(longNameData);
    expect(result.success).toBe(false);
  });

  it('should validate updateFolderSchema with valid optional fields', () => {
    const updateData = {
      name: '   Updated Name   ',
      isPublic: false,
    };

    const result = updateFolderSchema.safeParse(updateData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Name');
    }
  });

  it('should reject whitespace-only name updates in updateFolderSchema', () => {
    const invalidUpdateData = {
      name: '    ',
    };

    const result = updateFolderSchema.safeParse(invalidUpdateData);
    expect(result.success).toBe(false);
  });
});
