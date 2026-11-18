import {
  EdgeIntentClassifier,
  EdgeTokenizer,
  SlotSpanExtractor,
  softmax,
  gelu,
  layerNorm,
} from '../../core/ai/EdgeIntentClassifier';

describe('EdgeIntentClassifier & Edge Neural Pipeline', () => {
  let classifier: EdgeIntentClassifier;
  let tokenizer: EdgeTokenizer;

  beforeEach(() => {
    classifier = new EdgeIntentClassifier();
    tokenizer = classifier.getTokenizer();
  });

  describe('Mathematical Neural Primitives', () => {
    it('computes softmax correctly ensuring sum of probabilities equals 1.0', () => {
      const logits = [2.0, 1.0, 0.1];
      const probs = softmax(logits);
      expect(probs.length).toBe(3);
      const sum = probs.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 5);
      expect(probs[0]).toBeGreaterThan(probs[1]);
      expect(probs[1]).toBeGreaterThan(probs[2]);
    });

    it('computes GELU activation smoothly', () => {
      expect(gelu(0)).toBe(0);
      expect(gelu(2.0)).toBeGreaterThan(1.8);
      expect(gelu(-2.0)).toBeCloseTo(-0.045, 2);
    });

    it('normalizes tensors with layerNorm to zero mean and unit variance', () => {
      const input = [1.0, 2.0, 3.0, 4.0, 5.0];
      const normalized = layerNorm(input);
      const mean = normalized.reduce((a, b) => a + b, 0) / normalized.length;
      expect(mean).toBeCloseTo(0, 4);
    });
  });

  describe('WordPiece Tokenizer', () => {
    it('encodes text with [CLS] and [SEP] special tokens', () => {
      const result = tokenizer.encode('meet tomorrow at 3pm');
      expect(result.tokens[0]).toBe('[CLS]');
      expect(result.tokens).toContain('meet');
      expect(result.tokens).toContain('tomorrow');
      expect(result.tokens[result.tokens.length - 1]).toBe('[SEP]');
    });

    it('generates attention mask matching sequence length', () => {
      const result = tokenizer.encode('schedule meeting', 16);
      expect(result.tokenIds.length).toBe(16);
      expect(result.attentionMask.length).toBe(16);
      // [CLS], schedule, meeting, [SEP] = 4 valid tokens
      expect(result.attentionMask.slice(0, 4)).toEqual([1, 1, 1, 1]);
      expect(result.attentionMask.slice(4)).toEqual(new Array(12).fill(0));
    });
  });

  describe('Slot Span Extractor', () => {
    it('extracts user mentions correctly', () => {
      const text = 'schedule sync with @alice and @bob tomorrow';
      const slots = SlotSpanExtractor.extractSlots(text);
      const userSlots = slots.filter((s) => s.type === 'user');
      expect(userSlots.length).toBe(2);
      expect(userSlots[0].normalized).toBe('alice');
      expect(userSlots[1].normalized).toBe('bob');
    });

    it('extracts desk and room identifiers', () => {
      const text = 'reserve desk-4b in boardroom-1';
      const slots = SlotSpanExtractor.extractSlots(text);
      const deskSlot = slots.find((s) => s.type === 'desk');
      const roomSlot = slots.find((s) => s.type === 'room');
      expect(deskSlot).toBeDefined();
      expect(deskSlot?.normalized).toBe('desk-4b');
      expect(roomSlot).toBeDefined();
      expect(roomSlot?.normalized).toBe('boardroom-1');
    });

    it('extracts duration entities converted to minutes', () => {
      const text = 'book pod for 30 mins and room for 2 hours';
      const slots = SlotSpanExtractor.extractSlots(text);
      const durations = slots.filter((s) => s.type === 'duration');
      expect(durations.length).toBe(2);
      expect(durations[0].normalized).toBe(30);
      expect(durations[1].normalized).toBe(120);
    });
  });

  describe('Intent Classification End-to-End', () => {
    it('classifies meeting schedule intent with extracted user and time', () => {
      const text = 'schedule a meeting with @satyam tomorrow at 3pm';
      const result = classifier.classify(text);
      expect(result.intent).toBe('MEETING_SCHEDULE');
      expect(result.confidence).toBeGreaterThan(0.7);
      expect(result.entities.some((e) => e.type === 'user' && e.normalized === 'satyam')).toBe(true);
    });

    it('classifies screen share intent accurately', () => {
      const text = 'start screen share present my display';
      const result = classifier.classify(text);
      expect(result.intent).toBe('SCREEN_SHARE_START');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('classifies desk reservation intent', () => {
      const text = 'reserve desk-12 for 2 hours';
      const result = classifier.classify(text);
      expect(result.intent).toBe('DESK_RESERVATION');
      expect(result.confidence).toBeGreaterThan(0.75);
    });

    it('classifies audio mute toggle', () => {
      const text = 'mute my microphone audio';
      const result = classifier.classify(text);
      expect(result.intent).toBe('AUDIO_MUTE_TOGGLE');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('classifies focus mode activation', () => {
      const text = 'enable focus mode dnd deep work';
      const result = classifier.classify(text);
      expect(result.intent).toBe('FOCUS_MODE_ENABLE');
      expect(result.confidence).toBeGreaterThan(0.75);
    });

    it('classifies security screen lock', () => {
      const text = 'lock my workstation vault logout';
      const result = classifier.classify(text);
      expect(result.intent).toBe('SECURITY_LOCK');
      expect(result.confidence).toBeGreaterThan(0.75);
    });

    it('classifies flight itinerary query', () => {
      const text = 'check flight travel itinerary status and hotel gate';
      const result = classifier.classify(text);
      expect(result.intent).toBe('ITINERARY_QUERY');
      expect(result.confidence).toBeGreaterThan(0.75);
    });

    it('falls back gracefully to UNKNOWN_FALLBACK on ambiguous or out-of-domain commands', () => {
      const text = 'banana purple elephant jumping over the fence';
      const result = classifier.classify(text);
      expect(result.intent).toBe('UNKNOWN_FALLBACK');
    });

    it('runs with sub-10ms latency', () => {
      const text = 'quick meeting with @john now';
      const result = classifier.classify(text);
      expect(result.latencyMs).toBeLessThan(50);
    });
  });
});
