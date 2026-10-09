/**
 * AccessibleRouter.ts
 * Modifies standard OSRM graph weights to heavily penalize non-accessible routes based on elevation and OSM tags.
 * Provides real-time audible directional speech synthesis (Web Speech API) and distinct haptic vibration cues
 * for step-by-step guidance of visually impaired and wheelchair users.
 */

import { ElevationMatrix } from './ElevationMatrix';
import { OSMAccessibilityParser } from './OSMAccessibilityParser';

export type NavigationCueType = 'turn' | 'curb_ramp' | 'elevator' | 'straight' | 'destination';

export type TurnDirection =
  | 'left'
  | 'right'
  | 'slight_left'
  | 'slight_right'
  | 'sharp_left'
  | 'sharp_right'
  | 'u_turn'
  | 'straight';

export interface NavigationCue {
  id: string;
  type: NavigationCueType;
  instruction: string;
  distance?: number;
  turnDirection?: TurnDirection;
  vibrationPattern: number[];
  waypointIndex?: number;
  metadata?: Record<string, unknown>;
}

export const HAPTIC_PATTERNS = {
  TURN_LEFT: [150, 100, 300],          // Short tap followed by longer buzz indicating left turn
  TURN_RIGHT: [300, 100, 150],         // Long buzz followed by short tap indicating right turn
  TURN_GENERIC: [200, 100, 200],       // Double pulse for generic turn / u-turn
  CURB_RAMP: [100, 50, 100, 50, 100],  // Triple rapid pulses indicating surface/curb transition
  ELEVATOR: [400, 200, 400],           // Two long pulses indicating vertical transit waypoint
  DECISION_POINT: [200, 100, 200],     // Standard decision alert
  DESTINATION: [500],                  // Single solid confirmation pulse upon arrival
} as const;

export interface SpeechOptions {
  rate?: number;
  pitch?: number;
  volume?: number;
  voice?: SpeechSynthesisVoice | null;
  lang?: string;
}

export interface GuidanceOptions extends SpeechOptions {
  enableAudio?: boolean;
  enableHaptics?: boolean;
  autoAnnounceFirst?: boolean;
  onAnnounce?: (cue: NavigationCue) => void;
  onVibrate?: (pattern: number[]) => void;
  onStepChange?: (stepIndex: number, cue: NavigationCue | null) => void;
}

export interface RouteSegment {
  distance: number;
  duration: number;
  elevationGain: number;
  osmTags: Record<string, string>;
  instruction?: string;
  turn?: TurnDirection | string;
  waypointType?: NavigationCueType | string;
  name?: string;
}

export interface AccessibilityWeightedRoute {
  totalDistance: number;
  totalDuration: number;
  totalElevationGain?: number;
  accessibilityScore: number;
  penaltyMultiplier: number;
  isRecommended: boolean;
  segments: RouteSegment[];
  cues: NavigationCue[];
}

export interface AccessibleRouterDependencies {
  speechSynthesis?: SpeechSynthesis;
  navigator?: Navigator;
  elevationMatrix?: ElevationMatrix;
  osmParser?: OSMAccessibilityParser;
}

export class AccessibleRouter {
  private elevationMatrix: ElevationMatrix;
  private osmParser: OSMAccessibilityParser;
  private customSpeechSynthesis?: SpeechSynthesis;
  private customNavigator?: Navigator;

  // Step-by-step navigation state
  private activeCues: NavigationCue[] = [];
  private currentStepIndex: number = -1;
  private navigating: boolean = false;
  private guidanceOptions: GuidanceOptions = {
    enableAudio: true,
    enableHaptics: true,
    autoAnnounceFirst: true,
  };

  constructor(dependencies?: AccessibleRouterDependencies) {
    this.elevationMatrix = dependencies?.elevationMatrix || new ElevationMatrix();
    this.osmParser = dependencies?.osmParser || new OSMAccessibilityParser();
    this.customSpeechSynthesis = dependencies?.speechSynthesis;
    this.customNavigator = dependencies?.navigator;
  }

  private getSpeechSynthesis(): SpeechSynthesis | undefined {
    if (this.customSpeechSynthesis) return this.customSpeechSynthesis;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      return window.speechSynthesis;
    }
    return undefined;
  }

  private getNavigator(): Navigator | undefined {
    if (this.customNavigator) return this.customNavigator;
    if (typeof navigator !== 'undefined') {
      return navigator;
    }
    return undefined;
  }

  /**
   * Evaluates a route and applies accessibility penalties to its duration/weight.
   * Also generates directional navigation cues for step-by-step audible and haptic guidance.
   * @param segments Route segments from OSRM.
   * @param wheelchairMode If true, strictly penalizes non-compliant segments.
   */
  public evaluateRoute(segments: RouteSegment[], wheelchairMode: boolean = true): AccessibilityWeightedRoute {
    let totalDistance = 0;
    let totalDuration = 0;
    let totalElevationGain = 0;
    let totalPenaltyMultiplier = 1.0;
    let minSegmentScore = 100;

    const evaluatedSegments: RouteSegment[] = [];

    for (const segment of segments) {
      totalDistance += segment.distance;
      totalDuration += segment.duration;
      totalElevationGain += segment.elevationGain;

      const features = this.osmParser.parseFeatures(segment.osmTags);
      const segmentScore = this.osmParser.calculateScore(features);

      if (segmentScore < minSegmentScore) {
        minSegmentScore = segmentScore;
      }

      // Calculate penalty based on features and elevation
      let segmentMultiplier = 1.0;

      if (wheelchairMode) {
        if (!features.isWheelchairAccessible && !features.hasRamp) {
          segmentMultiplier += 2.0; // Heavy penalty for missing ramps/accessibility
        }

        // Simulate elevation check (in real impl, this uses DEM data per segment)
        const simulatedGrade = this.elevationMatrix.calculateGrade(segment.elevationGain, segment.distance);
        if (simulatedGrade > 8.33) {
          segmentMultiplier += (simulatedGrade - 8.33) / 5; // Progressive penalty for steepness
        }
      }

      totalPenaltyMultiplier = Math.max(totalPenaltyMultiplier, segmentMultiplier);
      evaluatedSegments.push(segment);
    }

    const adjustedDuration = totalDuration * totalPenaltyMultiplier;
    const isRecommended = minSegmentScore >= 60 && totalPenaltyMultiplier < 1.5;
    const cues = this.generateNavigationCues(evaluatedSegments);

    return {
      totalDistance,
      totalDuration: adjustedDuration,
      totalElevationGain,
      accessibilityScore: minSegmentScore,
      penaltyMultiplier: totalPenaltyMultiplier,
      isRecommended,
      segments: evaluatedSegments,
      cues,
    };
  }

  /**
   * Generates step-by-step navigation cues for a route, identifying turns,
   * curb ramps, elevator waypoints, and destinations with tailored instruction and vibration patterns.
   */
  public generateNavigationCues(segments: RouteSegment[]): NavigationCue[] {
    const cues: NavigationCue[] = [];

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index];
      const tags = segment.osmTags || {};
      const features = this.osmParser.parseFeatures(tags);
      const isLast = index === segments.length - 1;

      // 1. Elevator waypoint check
      const isElevator =
        segment.waypointType === 'elevator' ||
        features.hasElevator ||
        tags['highway'] === 'elevator' ||
        tags['amenity'] === 'elevator' ||
        tags['wheelchair:place'] === 'elevator' ||
        segment.instruction?.toLowerCase().includes('elevator');

      if (isElevator) {
        const distanceStr = segment.distance > 0 ? ` ahead in ${Math.round(segment.distance)} meters` : ' ahead';
        cues.push({
          id: `cue-${index}-elevator`,
          type: 'elevator',
          instruction: segment.instruction || `Elevator waypoint${distanceStr}. Take elevator for step-free access.`,
          distance: segment.distance,
          vibrationPattern: [...HAPTIC_PATTERNS.ELEVATOR],
          waypointIndex: index,
          metadata: { osmTags: tags },
        });
        continue;
      }

      // 2. Curb ramp check
      const isCurbRamp =
        segment.waypointType === 'curb_ramp' ||
        tags['kerb']?.toLowerCase() === 'lowered' ||
        tags['highway']?.toLowerCase() === 'curb_ramp' ||
        tags['curb']?.toLowerCase() === 'ramp' ||
        tags['barrier']?.toLowerCase() === 'kerb' ||
        segment.instruction?.toLowerCase().includes('curb ramp') ||
        segment.instruction?.toLowerCase().includes('lowered kerb') ||
        segment.instruction?.toLowerCase().includes('curb cut');

      if (isCurbRamp) {
        const distanceStr = segment.distance > 0 ? ` in ${Math.round(segment.distance)} meters` : ' ahead';
        cues.push({
          id: `cue-${index}-curb_ramp`,
          type: 'curb_ramp',
          instruction: segment.instruction || `Approaching curb ramp${distanceStr}.`,
          distance: segment.distance,
          vibrationPattern: [...HAPTIC_PATTERNS.CURB_RAMP],
          waypointIndex: index,
          metadata: { osmTags: tags },
        });
        continue;
      }

      // 3. Upcoming turn check
      const rawTurn = segment.turn || tags['turn'] || tags['maneuver'] || this.extractTurnFromInstruction(segment.instruction);
      if (rawTurn) {
        const turnDirection = this.normalizeTurnDirection(String(rawTurn));
        let pattern: number[];

        if (turnDirection === 'left' || turnDirection === 'slight_left' || turnDirection === 'sharp_left') {
          pattern = [...HAPTIC_PATTERNS.TURN_LEFT];
        } else if (turnDirection === 'right' || turnDirection === 'slight_right' || turnDirection === 'sharp_right') {
          pattern = [...HAPTIC_PATTERNS.TURN_RIGHT];
        } else {
          pattern = [...HAPTIC_PATTERNS.TURN_GENERIC];
        }

        const formattedTurn = turnDirection.replace(/_/g, ' ');
        const instruction = segment.instruction || (
          segment.distance > 0
            ? `In ${Math.round(segment.distance)} meters, turn ${formattedTurn}.`
            : `Turn ${formattedTurn}.`
        );

        cues.push({
          id: `cue-${index}-turn`,
          type: 'turn',
          turnDirection,
          instruction,
          distance: segment.distance,
          vibrationPattern: pattern,
          waypointIndex: index,
          metadata: { turn: turnDirection },
        });
        continue;
      }

      // 4. Destination waypoint check
      if (segment.waypointType === 'destination' || (isLast && segment.distance <= 10)) {
        cues.push({
          id: `cue-${index}-destination`,
          type: 'destination',
          instruction: segment.instruction || 'You have arrived at your destination.',
          distance: segment.distance,
          vibrationPattern: [...HAPTIC_PATTERNS.DESTINATION],
          waypointIndex: index,
        });
        continue;
      }

      // 5. Straight / general guidance segment
      const straightInstruction = segment.instruction || (
        segment.distance > 0
          ? `Continue straight for ${Math.round(segment.distance)} meters.`
          : 'Continue straight.'
      );

      cues.push({
        id: `cue-${index}-straight`,
        type: 'straight',
        instruction: straightInstruction,
        distance: segment.distance,
        vibrationPattern: [...HAPTIC_PATTERNS.DECISION_POINT],
        waypointIndex: index,
      });
    }

    return cues;
  }

  /**
   * Normalizes turn direction string to standardized enum.
   */
  private normalizeTurnDirection(raw: string): TurnDirection {
    const clean = raw.toLowerCase().trim().replace(/[- ]/g, '_');
    if (clean.includes('sharp_left')) return 'sharp_left';
    if (clean.includes('slight_left')) return 'slight_left';
    if (clean.includes('left')) return 'left';
    if (clean.includes('sharp_right')) return 'sharp_right';
    if (clean.includes('slight_right')) return 'slight_right';
    if (clean.includes('right')) return 'right';
    if (clean.includes('u_turn') || clean.includes('uturn')) return 'u_turn';
    return 'straight';
  }

  /**
   * Extracts turn indicator from natural language instruction text.
   */
  private extractTurnFromInstruction(instruction?: string): string | null {
    if (!instruction) return null;
    const lower = instruction.toLowerCase();
    const match = lower.match(/\b(turn|bear|make a)\s+(sharp left|slight left|left|sharp right|slight right|right|u-turn)\b/);
    return match ? match[2] : null;
  }

  /**
   * Performs directional speech synthesis using Web Speech API (window.speechSynthesis).
   * Automatically cancels any ongoing speech before announcing the new real-time guidance cue.
   */
  public speak(text: string, options?: SpeechOptions): boolean {
    if (!text) return false;
    const synth = this.getSpeechSynthesis();
    if (!synth) return false;

    try {
      if (typeof synth.cancel === 'function') {
        synth.cancel();
      }

      const UtteranceConstructor =
        typeof window !== 'undefined' && 'SpeechSynthesisUtterance' in window
          ? window.SpeechSynthesisUtterance
          : (globalThis as unknown as { SpeechSynthesisUtterance: new (text?: string) => SpeechSynthesisUtterance }).SpeechSynthesisUtterance;

      if (!UtteranceConstructor) return false;

      const utterance = new UtteranceConstructor(text);
      if (options?.rate !== undefined) utterance.rate = options.rate;
      if (options?.pitch !== undefined) utterance.pitch = options.pitch;
      if (options?.volume !== undefined) utterance.volume = options.volume;
      if (options?.voice) utterance.voice = options.voice;
      if (options?.lang) utterance.lang = options.lang;

      synth.speak(utterance);
      return true;
    } catch (err) {
      console.error('Speech synthesis error in AccessibleRouter:', err);
      return false;
    }
  }

  /**
   * Triggers distinct haptic vibration feedback using the Vibration API (navigator.vibrate).
   */
  public triggerHapticFeedback(pattern: number[] | number): boolean {
    const nav = this.getNavigator();
    if (!nav || typeof nav.vibrate !== 'function') return false;

    try {
      return nav.vibrate(pattern);
    } catch (err) {
      console.error('Haptic vibration error in AccessibleRouter:', err);
      return false;
    }
  }

  /**
   * Announces an upcoming navigation cue with synchronized audible speech synthesis
   * and distinct haptic vibration patterns on supported mobile devices.
   */
  public announceCue(cue: NavigationCue, options?: Partial<GuidanceOptions>): { spoken: boolean; vibrated: boolean } {
    const opts = { ...this.guidanceOptions, ...options };
    let spoken = false;
    let vibrated = false;

    if (opts.enableAudio !== false) {
      spoken = this.speak(cue.instruction, opts);
      opts.onAnnounce?.(cue);
    }

    if (opts.enableHaptics !== false) {
      vibrated = this.triggerHapticFeedback(cue.vibrationPattern);
      opts.onVibrate?.(cue.vibrationPattern);
    }

    return { spoken, vibrated };
  }

  /**
   * Starts real-time step-by-step guidance along the accessible route.
   */
  public startNavigation(
    routeOrSegments: AccessibilityWeightedRoute | RouteSegment[],
    options?: GuidanceOptions
  ): NavigationCue[] {
    if (options) {
      this.guidanceOptions = { ...this.guidanceOptions, ...options };
    }

    if (Array.isArray(routeOrSegments)) {
      this.activeCues = this.generateNavigationCues(routeOrSegments);
    } else {
      this.activeCues = routeOrSegments.cues && routeOrSegments.cues.length > 0
        ? routeOrSegments.cues
        : this.generateNavigationCues(routeOrSegments.segments);
    }

    this.navigating = true;
    this.currentStepIndex = 0;

    const firstCue = this.getCurrentCue();
    if (firstCue && this.guidanceOptions.autoAnnounceFirst !== false) {
      this.announceCue(firstCue);
    }

    this.guidanceOptions.onStepChange?.(this.currentStepIndex, firstCue);
    return this.activeCues;
  }

  /**
   * Stops active step-by-step guidance and silences any ongoing speech synthesis or haptic pulses.
   */
  public stopNavigation(): void {
    this.navigating = false;
    this.currentStepIndex = -1;
    this.activeCues = [];

    const synth = this.getSpeechSynthesis();
    if (synth && typeof synth.cancel === 'function') {
      synth.cancel();
    }

    const nav = this.getNavigator();
    if (nav && typeof nav.vibrate === 'function') {
      try {
        nav.vibrate(0);
      } catch {
        // Ignore cancel errors
      }
    }
  }

  /**
   * Advances to the next navigation step and announces the corresponding cue.
   */
  public nextStep(): NavigationCue | null {
    if (!this.navigating || this.activeCues.length === 0) return null;
    if (this.currentStepIndex + 1 >= this.activeCues.length) return null;

    this.currentStepIndex++;
    const cue = this.getCurrentCue();
    if (cue) {
      this.announceCue(cue);
    }
    this.guidanceOptions.onStepChange?.(this.currentStepIndex, cue);
    return cue;
  }

  /**
   * Moves back to the previous navigation step and announces the corresponding cue.
   */
  public previousStep(): NavigationCue | null {
    if (!this.navigating || this.activeCues.length === 0) return null;
    if (this.currentStepIndex <= 0) return null;

    this.currentStepIndex--;
    const cue = this.getCurrentCue();
    if (cue) {
      this.announceCue(cue);
    }
    this.guidanceOptions.onStepChange?.(this.currentStepIndex, cue);
    return cue;
  }

  /**
   * Navigates directly to a specific step index.
   */
  public goToStep(stepIndex: number): NavigationCue | null {
    if (!this.navigating || stepIndex < 0 || stepIndex >= this.activeCues.length) return null;

    this.currentStepIndex = stepIndex;
    const cue = this.getCurrentCue();
    if (cue) {
      this.announceCue(cue);
    }
    this.guidanceOptions.onStepChange?.(this.currentStepIndex, cue);
    return cue;
  }

  /**
   * Returns current active navigation cue.
   */
  public getCurrentCue(): NavigationCue | null {
    if (!this.navigating || this.currentStepIndex < 0 || this.currentStepIndex >= this.activeCues.length) {
      return null;
    }
    return this.activeCues[this.currentStepIndex] || null;
  }

  /**
   * Returns current active step index.
   */
  public getCurrentStepIndex(): number {
    return this.currentStepIndex;
  }

  /**
   * Returns total number of steps in current active route.
   */
  public getTotalSteps(): number {
    return this.activeCues.length;
  }

  /**
   * Returns whether real-time step-by-step navigation is active.
   */
  public isNavigating(): boolean {
    return this.navigating;
  }

  /**
   * Returns all active navigation cues for the route.
   */
  public getCues(): NavigationCue[] {
    return [...this.activeCues];
  }

  /**
   * Configures global guidance options (speech rate, pitch, callbacks, audio/haptic toggles).
   */
  public setGuidanceOptions(options: Partial<GuidanceOptions>): void {
    this.guidanceOptions = { ...this.guidanceOptions, ...options };
  }

  /**
   * Retrieves active guidance options.
   */
  public getGuidanceOptions(): GuidanceOptions {
    return { ...this.guidanceOptions };
  }
}
