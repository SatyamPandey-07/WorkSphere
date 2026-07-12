import { calculateLevel } from "../../lib/gamification";

describe("Profile Gamification Level Calculations", () => {
    it("should calculate correct level and progress for 0 XP", () => {
        const lvlInfo = calculateLevel(0);
        expect(lvlInfo).toEqual({
            level: 1,
            xp: 0,
            xpInCurrentLevel: 0,
            xpForNextLevel: 100,
            progressPercent: 0,
        });
    });

    it("should calculate correct level and progress for 50 XP", () => {
        const lvlInfo = calculateLevel(50);
        expect(lvlInfo).toEqual({
            level: 1,
            xp: 50,
            xpInCurrentLevel: 50,
            xpForNextLevel: 100,
            progressPercent: 50,
        });
    });

    it("should calculate correct level and progress for 100 XP (Level Up)", () => {
        const lvlInfo = calculateLevel(100);
        expect(lvlInfo).toEqual({
            level: 2,
            xp: 100,
            xpInCurrentLevel: 0,
            xpForNextLevel: 200,
            progressPercent: 0,
        });
    });

    it("should calculate correct level and progress for 250 XP", () => {
        const lvlInfo = calculateLevel(250);
        expect(lvlInfo).toEqual({
            level: 2,
            xp: 250,
            xpInCurrentLevel: 150,
            xpForNextLevel: 200,
            progressPercent: 75,
        });
    });

    it("should calculate correct level and progress for 300 XP (Level Up)", () => {
        const lvlInfo = calculateLevel(300);
        expect(lvlInfo).toEqual({
            level: 3,
            xp: 300,
            xpInCurrentLevel: 0,
            xpForNextLevel: 300,
            progressPercent: 0,
        });
    });

    it("should calculate correct level and progress for 550 XP", () => {
        const lvlInfo = calculateLevel(550);
        expect(lvlInfo.level).toBe(3);
        expect(lvlInfo.xpInCurrentLevel).toBe(250);
        expect(lvlInfo.xpForNextLevel).toBe(300);
        expect(lvlInfo.progressPercent).toBe(83); // 250 / 300 * 100 = 83.333%
    });

    it("should calculate correct level and progress for 600 XP (Level Up)", () => {
        const lvlInfo = calculateLevel(600);
        expect(lvlInfo.level).toBe(4);
        expect(lvlInfo.xpInCurrentLevel).toBe(0);
        expect(lvlInfo.xpForNextLevel).toBe(400);
    });
});
