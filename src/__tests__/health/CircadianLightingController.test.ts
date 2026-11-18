import {
  CircadianLightingController,
  UserChronotype,
} from '../../core/health/CircadianLightingController';

describe('CircadianLightingController', () => {
  let controller: CircadianLightingController;

  beforeEach(() => {
    controller = new CircadianLightingController();
  });

  describe('Photobiological Melanopic Lux (EML) Calculations', () => {
    it('computes Equivalent Melanopic Lux conforming to CIE S 026 / WELL v2', () => {
      // Warm light (2700K) has lower melanopic ratio (~0.51)
      const warm = controller.computeEquivalentMelanopicLux(500, 2700);
      expect(warm.melanopicRatio).toBeLessThan(0.6);
      expect(warm.eml).toBeLessThan(300);

      // Cool daylight (6500K) has high melanopic ratio (> 1.0)
      const daylight = controller.computeEquivalentMelanopicLux(500, 6500);
      expect(daylight.melanopicRatio).toBeGreaterThan(0.95);
      expect(daylight.eml).toBeGreaterThan(450);
    });
  });

  describe('Diurnal CCT & Illuminance Progression', () => {
    it('generates high CCT and peak lux during midday solar noon (11:00 AM)', () => {
      const noonDate = new Date(2026, 10, 17, 11, 0, 0);
      const target = controller.calculateCircadianTarget(noonDate, 'INTERMEDIATE');

      expect(target.diurnalPhase).toBe('SOLAR_NOON_PEAK');
      expect(target.cctKelvin).toBeGreaterThanOrEqual(5500);
      expect(target.photopicLux).toBeGreaterThanOrEqual(700);
      expect(target.circadianStimulusScore).toBeGreaterThanOrEqual(0.3); // WELL standard threshold
    });

    it('generates warm melatonin-preserving lighting during evening wind-down (10:30 PM)', () => {
      const nightDate = new Date(2026, 10, 17, 22, 30, 0);
      const target = controller.calculateCircadianTarget(nightDate, 'INTERMEDIATE');

      expect(target.diurnalPhase).toBe('WIND_DOWN');
      expect(target.cctKelvin).toBeLessThanOrEqual(2500);
      expect(target.photopicLux).toBeLessThanOrEqual(150);
    });

    it('generates minimal disturbance lighting at 2:00 AM night', () => {
      const midnightDate = new Date(2026, 10, 17, 2, 0, 0);
      const target = controller.calculateCircadianTarget(midnightDate, 'INTERMEDIATE');

      expect(target.diurnalPhase).toBe('NIGHT');
      expect(target.cctKelvin).toBe(2200);
      expect(target.photopicLux).toBe(80);
    });
  });

  describe('Chronotype Adaptation', () => {
    it('shifts diurnal peak earlier for EARLY_LARK and later for NIGHT_OWL', () => {
      const morningDate = new Date(2026, 10, 17, 8, 45, 0); // 8:45 AM

      const larkTarget = controller.calculateCircadianTarget(morningDate, 'EARLY_LARK');
      const owlTarget = controller.calculateCircadianTarget(morningDate, 'NIGHT_OWL');

      // At 8:45 AM, Early Lark is already in peak solar noon phase, while Night Owl is still in morning ramp
      expect(larkTarget.cctKelvin).toBeGreaterThan(owlTarget.cctKelvin);
      expect(larkTarget.photopicLux).toBeGreaterThan(owlTarget.photopicLux);
    });
  });

  describe('Focus Burst & Luminaire Commands', () => {
    it('overrides schedule during active Deep Focus Burst', () => {
      const eveningDate = new Date(2026, 10, 17, 21, 0, 0); // 9:00 PM
      controller.triggerFocusBurst(45, 5800, 750);

      const target = controller.calculateCircadianTarget(eveningDate);
      expect(target.cctKelvin).toBe(5800);
      expect(target.photopicLux).toBe(750);

      // Cancel focus burst reverts to evening
      controller.cancelFocusBurst();
      const reverted = controller.calculateCircadianTarget(eveningDate);
      expect(reverted.cctKelvin).toBeLessThan(3000);
    });

    it('dispatches properly scaled dimming commands to smart luminaires', () => {
      const noonDate = new Date(2026, 10, 17, 11, 0, 0);
      const luminaires = [
        { id: 'lum-desk-1', maxLuxRating: 1000 },
        { id: 'lum-ambient-2', maxLuxRating: 800 },
      ];

      const commands = controller.generateLuminaireCommands(luminaires, noonDate);
      expect(commands.length).toBe(2);
      expect(commands[0].dimmingPercent).toBeGreaterThan(70);
      expect(commands[0].transitionDurationMs).toBe(900000); // 15m
    });
  });
});
