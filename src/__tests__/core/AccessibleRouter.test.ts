/**
 * AccessibleRouter.test.ts
 * Tests for AccessibleRouter directional speech synthesis and haptic vibration cues.
 */

import {
  AccessibleRouter,
  HAPTIC_PATTERNS,
  NavigationCue,
  RouteSegment,
} from '@/core/accessibility/AccessibleRouter';

describe('AccessibleRouter', () => {
  let mockSpeak: jest.Mock;
  let mockCancel: jest.Mock;
  let mockVibrate: jest.Mock;
  let mockSpeechSynthesis: any;
  let mockNavigator: any;

  class MockSpeechSynthesisUtterance {
    text: string;
    rate: number = 1;
    pitch: number = 1;
    volume: number = 1;
    lang: string = '';
    voice: any = null;

    constructor(text: string = '') {
      this.text = text;
    }
  }

  beforeEach(() => {
    mockSpeak = jest.fn();
    mockCancel = jest.fn();
    mockVibrate = jest.fn().mockReturnValue(true);

    mockSpeechSynthesis = {
      speak: mockSpeak,
      cancel: mockCancel,
      speaking: false,
      paused: false,
      pending: false,
    };

    mockNavigator = {
      vibrate: mockVibrate,
    };

    (globalThis as any).SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
  });

  afterEach(() => {
    delete (globalThis as any).SpeechSynthesisUtterance;
    jest.clearAllMocks();
  });

  describe('Route Evaluation and Cue Generation', () => {
    it('evaluates routes with penalties and attaches generated navigation cues', () => {
      const router = new AccessibleRouter();
      const segments: RouteSegment[] = [
        {
          distance: 50,
          duration: 40,
          elevationGain: 1,
          osmTags: { highway: 'footway' },
          turn: 'right',
        },
        {
          distance: 20,
          duration: 15,
          elevationGain: 0,
          osmTags: { highway: 'footway', kerb: 'lowered' },
        },
        {
          distance: 10,
          duration: 10,
          elevationGain: 5,
          osmTags: { highway: 'elevator' },
        },
      ];

      const evaluation = router.evaluateRoute(segments, true);

      expect(evaluation.totalDistance).toBe(80);
      expect(evaluation.cues).toHaveLength(3);
      expect(evaluation.cues[0].type).toBe('turn');
      expect(evaluation.cues[0].turnDirection).toBe('right');
      expect(evaluation.cues[1].type).toBe('curb_ramp');
      expect(evaluation.cues[2].type).toBe('elevator');
    });
  });

  describe('Decision Point Recognition & Distinct Haptic Vibration Patterns', () => {
    let router: AccessibleRouter;

    beforeEach(() => {
      router = new AccessibleRouter({
        speechSynthesis: mockSpeechSynthesis,
        navigator: mockNavigator,
      });
    });

    it('identifies upcoming left turns and assigns the TURN_LEFT distinct haptic pattern', () => {
      const segments: RouteSegment[] = [
        {
          distance: 30,
          duration: 25,
          elevationGain: 0,
          osmTags: { highway: 'footway' },
          turn: 'left',
        },
      ];

      const cues = router.generateNavigationCues(segments);

      expect(cues).toHaveLength(1);
      expect(cues[0].type).toBe('turn');
      expect(cues[0].turnDirection).toBe('left');
      expect(cues[0].instruction).toBe('In 30 meters, turn left.');
      expect(cues[0].vibrationPattern).toEqual(HAPTIC_PATTERNS.TURN_LEFT);
      expect(cues[0].vibrationPattern).toEqual([150, 100, 300]);
    });

    it('identifies upcoming right turns and assigns the TURN_RIGHT distinct haptic pattern', () => {
      const segments: RouteSegment[] = [
        {
          distance: 45,
          duration: 35,
          elevationGain: 0,
          osmTags: { highway: 'footway' },
          turn: 'sharp_right',
        },
      ];

      const cues = router.generateNavigationCues(segments);

      expect(cues).toHaveLength(1);
      expect(cues[0].type).toBe('turn');
      expect(cues[0].turnDirection).toBe('sharp_right');
      expect(cues[0].instruction).toBe('In 45 meters, turn sharp right.');
      expect(cues[0].vibrationPattern).toEqual(HAPTIC_PATTERNS.TURN_RIGHT);
      expect(cues[0].vibrationPattern).toEqual([300, 100, 150]);
    });

    it('identifies u-turns and assigns the TURN_GENERIC distinct haptic pattern', () => {
      const segments: RouteSegment[] = [
        {
          distance: 10,
          duration: 10,
          elevationGain: 0,
          osmTags: { highway: 'footway' },
          turn: 'u_turn',
        },
      ];

      const cues = router.generateNavigationCues(segments);

      expect(cues).toHaveLength(1);
      expect(cues[0].type).toBe('turn');
      expect(cues[0].turnDirection).toBe('u_turn');
      expect(cues[0].vibrationPattern).toEqual(HAPTIC_PATTERNS.TURN_GENERIC);
      expect(cues[0].vibrationPattern).toEqual([200, 100, 200]);
    });

    it('extracts turns from natural language instruction text', () => {
      const segments: RouteSegment[] = [
        {
          distance: 25,
          duration: 20,
          elevationGain: 0,
          osmTags: {},
          instruction: 'Turn left toward concourse A',
        },
      ];

      const cues = router.generateNavigationCues(segments);

      expect(cues[0].type).toBe('turn');
      expect(cues[0].turnDirection).toBe('left');
      expect(cues[0].vibrationPattern).toEqual(HAPTIC_PATTERNS.TURN_LEFT);
    });

    it('identifies curb ramps and assigns the CURB_RAMP distinct triple-tap haptic pattern', () => {
      const segments: RouteSegment[] = [
        {
          distance: 15,
          duration: 12,
          elevationGain: 0,
          osmTags: { highway: 'footway', kerb: 'lowered' },
        },
      ];

      const cues = router.generateNavigationCues(segments);

      expect(cues).toHaveLength(1);
      expect(cues[0].type).toBe('curb_ramp');
      expect(cues[0].instruction).toBe('Approaching curb ramp in 15 meters.');
      expect(cues[0].vibrationPattern).toEqual(HAPTIC_PATTERNS.CURB_RAMP);
      expect(cues[0].vibrationPattern).toEqual([100, 50, 100, 50, 100]);
    });

    it('identifies elevator waypoints and assigns the ELEVATOR distinct heavy haptic pattern', () => {
      const segments: RouteSegment[] = [
        {
          distance: 20,
          duration: 15,
          elevationGain: 3,
          osmTags: { highway: 'elevator', wheelchair: 'yes' },
        },
      ];

      const cues = router.generateNavigationCues(segments);

      expect(cues).toHaveLength(1);
      expect(cues[0].type).toBe('elevator');
      expect(cues[0].instruction).toBe('Elevator waypoint ahead in 20 meters. Take elevator for step-free access.');
      expect(cues[0].vibrationPattern).toEqual(HAPTIC_PATTERNS.ELEVATOR);
      expect(cues[0].vibrationPattern).toEqual([400, 200, 400]);
    });

    it('identifies destination waypoints and assigns the DESTINATION long pulse haptic pattern', () => {
      const segments: RouteSegment[] = [
        {
          distance: 0,
          duration: 0,
          elevationGain: 0,
          osmTags: {},
          waypointType: 'destination',
          instruction: 'You have arrived at Room 402.',
        },
      ];

      const cues = router.generateNavigationCues(segments);

      expect(cues).toHaveLength(1);
      expect(cues[0].type).toBe('destination');
      expect(cues[0].instruction).toBe('You have arrived at Room 402.');
      expect(cues[0].vibrationPattern).toEqual(HAPTIC_PATTERNS.DESTINATION);
      expect(cues[0].vibrationPattern).toEqual([500]);
    });
  });

  describe('Audible Web Speech API Directional Synthesis & Haptics Triggering', () => {
    let router: AccessibleRouter;

    beforeEach(() => {
      router = new AccessibleRouter({
        speechSynthesis: mockSpeechSynthesis,
        navigator: mockNavigator,
      });
    });

    it('cancels ongoing speech and speaks announcement with specified options', () => {
      const spoken = router.speak('Turn right in 10 meters', { rate: 1.2, pitch: 1.1, volume: 0.8 });

      expect(spoken).toBe(true);
      expect(mockCancel).toHaveBeenCalledTimes(1);
      expect(mockSpeak).toHaveBeenCalledTimes(1);

      const utterance = mockSpeak.mock.calls[0][0];
      expect(utterance.text).toBe('Turn right in 10 meters');
      expect(utterance.rate).toBe(1.2);
      expect(utterance.pitch).toBe(1.1);
      expect(utterance.volume).toBe(0.8);
    });

    it('triggers haptic feedback on supported mobile devices', () => {
      const triggered = router.triggerHapticFeedback([100, 50, 100]);

      expect(triggered).toBe(true);
      expect(mockVibrate).toHaveBeenCalledWith([100, 50, 100]);
    });

    it('announces cue with synchronized speech synthesis and haptic vibration pattern', () => {
      const cue: NavigationCue = {
        id: 'test-cue-1',
        type: 'curb_ramp',
        instruction: 'Approaching curb ramp in 10 meters.',
        vibrationPattern: HAPTIC_PATTERNS.CURB_RAMP,
      };

      const onAnnounce = jest.fn();
      const onVibrate = jest.fn();

      const result = router.announceCue(cue, { onAnnounce, onVibrate });

      expect(result.spoken).toBe(true);
      expect(result.vibrated).toBe(true);
      expect(mockCancel).toHaveBeenCalled();
      expect(mockSpeak).toHaveBeenCalledTimes(1);
      expect(mockVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.CURB_RAMP);
      expect(onAnnounce).toHaveBeenCalledWith(cue);
      expect(onVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.CURB_RAMP);
    });

    it('respects enableAudio=false and enableHaptics=false configuration toggles', () => {
      const cue: NavigationCue = {
        id: 'test-cue-2',
        type: 'elevator',
        instruction: 'Elevator ahead.',
        vibrationPattern: HAPTIC_PATTERNS.ELEVATOR,
      };

      const result = router.announceCue(cue, { enableAudio: false, enableHaptics: false });

      expect(result.spoken).toBe(false);
      expect(result.vibrated).toBe(false);
      expect(mockSpeak).not.toHaveBeenCalled();
      expect(mockVibrate).not.toHaveBeenCalled();
    });

    it('gracefully handles missing SpeechSynthesis or Navigator without throwing', () => {
      const routerWithoutBrowserApis = new AccessibleRouter({
        speechSynthesis: undefined,
        navigator: undefined,
      });

      expect(() => routerWithoutBrowserApis.speak('Test announcement')).not.toThrow();
      expect(routerWithoutBrowserApis.speak('Test announcement')).toBe(false);

      expect(() => routerWithoutBrowserApis.triggerHapticFeedback([100])).not.toThrow();
      expect(routerWithoutBrowserApis.triggerHapticFeedback([100])).toBe(false);
    });
  });

  describe('Step-by-Step Navigation Guidance', () => {
    let router: AccessibleRouter;
    const testSegments: RouteSegment[] = [
      {
        distance: 20,
        duration: 15,
        elevationGain: 0,
        osmTags: { highway: 'footway' },
        turn: 'left',
      },
      {
        distance: 10,
        duration: 8,
        elevationGain: 0,
        osmTags: { highway: 'footway', kerb: 'lowered' },
      },
      {
        distance: 15,
        duration: 12,
        elevationGain: 3,
        osmTags: { highway: 'elevator' },
      },
    ];

    beforeEach(() => {
      router = new AccessibleRouter({
        speechSynthesis: mockSpeechSynthesis,
        navigator: mockNavigator,
      });
    });

    it('starts step-by-step guidance and automatically announces the first waypoint', () => {
      const onStepChange = jest.fn();
      const cues = router.startNavigation(testSegments, { onStepChange });

      expect(router.isNavigating()).toBe(true);
      expect(router.getCurrentStepIndex()).toBe(0);
      expect(router.getTotalSteps()).toBe(3);
      expect(router.getCurrentCue()).toEqual(cues[0]);

      // Verifies first cue was announced
      expect(mockSpeak).toHaveBeenCalledTimes(1);
      expect(mockVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.TURN_LEFT);
      expect(onStepChange).toHaveBeenCalledWith(0, cues[0]);
    });

    it('advances through turns, curb ramps, and elevators via nextStep()', () => {
      router.startNavigation(testSegments);
      mockSpeak.mockClear();
      mockVibrate.mockClear();

      // Step 1: Curb ramp
      const step1Cue = router.nextStep();
      expect(step1Cue?.type).toBe('curb_ramp');
      expect(router.getCurrentStepIndex()).toBe(1);
      expect(mockSpeak).toHaveBeenCalledTimes(1);
      expect(mockVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.CURB_RAMP);

      mockSpeak.mockClear();
      mockVibrate.mockClear();

      // Step 2: Elevator waypoint
      const step2Cue = router.nextStep();
      expect(step2Cue?.type).toBe('elevator');
      expect(router.getCurrentStepIndex()).toBe(2);
      expect(mockSpeak).toHaveBeenCalledTimes(1);
      expect(mockVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.ELEVATOR);

      // Beyond end returns null and keeps index at 2
      const beyond = router.nextStep();
      expect(beyond).toBeNull();
      expect(router.getCurrentStepIndex()).toBe(2);
    });

    it('allows navigating backward with previousStep()', () => {
      router.startNavigation(testSegments);
      router.nextStep(); // at step 1
      expect(router.getCurrentStepIndex()).toBe(1);

      mockSpeak.mockClear();
      mockVibrate.mockClear();

      const prevCue = router.previousStep();
      expect(prevCue?.type).toBe('turn');
      expect(router.getCurrentStepIndex()).toBe(0);
      expect(mockVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.TURN_LEFT);
    });

    it('allows jumping directly to a step via goToStep()', () => {
      router.startNavigation(testSegments);
      mockSpeak.mockClear();
      mockVibrate.mockClear();

      const jumpedCue = router.goToStep(2);
      expect(jumpedCue?.type).toBe('elevator');
      expect(router.getCurrentStepIndex()).toBe(2);
      expect(mockVibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.ELEVATOR);
    });

    it('stops navigation, clears cues, and cancels any active audio and haptics', () => {
      router.startNavigation(testSegments);
      expect(router.isNavigating()).toBe(true);

      router.stopNavigation();
      expect(router.isNavigating()).toBe(false);
      expect(router.getCurrentStepIndex()).toBe(-1);
      expect(router.getCurrentCue()).toBeNull();
      expect(mockCancel).toHaveBeenCalled();
      expect(mockVibrate).toHaveBeenCalledWith(0);
    });
  });
});
