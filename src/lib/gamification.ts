/**
 * Gamification calculations for user contribution levels and XP progress
 */

export function calculateLevel(xp: number) {
    if (!Number.isFinite(xp) || xp < 0) {
        return {
            level: 1,
            xp: 0,
            xpInCurrentLevel: 0,
            xpForNextLevel: 100,
            progressPercent: 0,
        };
    }
    const cleanXp = Math.floor(xp);
    let level = 1;
    let xpForNextLevel = 100;
    let tempXp = cleanXp;
    
    while (tempXp >= xpForNextLevel) {
        tempXp -= xpForNextLevel;
        level++;
        xpForNextLevel = level * 100;
    }
    
    const progressPercent = Math.max(0, Math.min(Math.round((tempXp / xpForNextLevel) * 100), 100));
    return {
        level,
        xp: cleanXp,
        xpInCurrentLevel: tempXp,
        xpForNextLevel,
        progressPercent,
    };
}
