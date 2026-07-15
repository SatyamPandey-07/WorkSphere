/**
 * Gamification calculations for user contribution levels and XP progress
 */

export function calculateLevel(xp: number) {
    let level = 1;
    let xpForNextLevel = 100;
    let tempXp = xp;
    
    while (tempXp >= xpForNextLevel) {
        tempXp -= xpForNextLevel;
        level++;
        xpForNextLevel = level * 100;
    }
    
    const progressPercent = Math.min(Math.round((tempXp / xpForNextLevel) * 100), 100);
    return {
        level,
        xp,
        xpInCurrentLevel: tempXp,
        xpForNextLevel,
        progressPercent,
    };
}
