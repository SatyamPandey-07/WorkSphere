import { cn } from '@/lib/utils';

describe('Utils', () => {
  describe('cn (classnames utility)', () => {
    it('merges class names correctly', () => {
      const result = cn('class1', 'class2');
      expect(result).toBe('class1 class2');
    });

    it('handles conditional classes', () => {
      const isActive = true;
      const result = cn('base', isActive && 'active');
      expect(result).toBe('base active');
    });

    it('filters out falsy values', () => {
      const result = cn('base', false, null, undefined, 'valid');
      expect(result).toBe('base valid');
    });

    it('handles tailwind merge conflicts', () => {
      const result = cn('px-2 py-1', 'px-4');
      expect(result).toBe('py-1 px-4');
    });

    it('handles empty input', () => {
      const result = cn();
      expect(result).toBe('');
    });

    it('handles array of classes', () => {
      const result = cn(['class1', 'class2']);
      expect(result).toContain('class1');
      expect(result).toContain('class2');
    });
  });
});
