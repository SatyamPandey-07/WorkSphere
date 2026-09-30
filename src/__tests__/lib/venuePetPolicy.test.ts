/**
 * Tests for venue pet policy and compatibility checking.
 */

type PetType = "dog" | "cat" | "bird" | "other";

interface PetPolicy {
  venueId: string;
  allowedPets: PetType[];
  petFriendlyZones: string[];
  maxPetsAllowed: number;
  requiresHealthCert: boolean;
  petDepositCents: number;
}

interface PetRegistration {
  petId: string;
  userId: string;
  type: PetType;
  name: string;
  hasHealthCert: boolean;
}

function isPetAllowed(policy: PetPolicy, pet: PetRegistration): boolean {
  if (!policy.allowedPets.includes(pet.type)) return false;
  if (policy.requiresHealthCert && !pet.hasHealthCert) return false;
  return true;
}

function checkPetAdmission(
  policy: PetPolicy,
  pets: PetRegistration[]
): { admitted: PetRegistration[]; rejected: PetRegistration[]; reason: string[] } {
  const admitted: PetRegistration[] = [];
  const rejected: PetRegistration[] = [];
  const reason: string[] = [];

  for (const pet of pets) {
    if (!policy.allowedPets.includes(pet.type)) {
      rejected.push(pet);
      reason.push(`${pet.name}: ${pet.type} not allowed`);
    } else if (policy.requiresHealthCert && !pet.hasHealthCert) {
      rejected.push(pet);
      reason.push(`${pet.name}: health cert required`);
    } else if (admitted.length >= policy.maxPetsAllowed) {
      rejected.push(pet);
      reason.push(`${pet.name}: max pets reached`);
    } else {
      admitted.push(pet);
    }
  }

  return { admitted, rejected, reason };
}

function totalPetDeposit(policy: PetPolicy, petCount: number): number {
  return policy.petDepositCents * Math.min(petCount, policy.maxPetsAllowed);
}

const POLICY: PetPolicy = {
  venueId: "v1", allowedPets: ["dog", "cat"],
  petFriendlyZones: ["patio", "garden"], maxPetsAllowed: 2,
  requiresHealthCert: true, petDepositCents: 5000,
};

const DOG: PetRegistration = { petId: "p1", userId: "u1", type: "dog",  name: "Rex",   hasHealthCert: true  };
const CAT: PetRegistration = { petId: "p2", userId: "u1", type: "cat",  name: "Mimi",  hasHealthCert: false };
const BIRD: PetRegistration = { petId: "p3", userId: "u1", type: "bird", name: "Tweety",hasHealthCert: true  };

describe("Venue pet policy", () => {
  it("isPetAllowed: dog with cert → true", () => {
    expect(isPetAllowed(POLICY, DOG)).toBe(true);
  });

  it("isPetAllowed: cat without cert → false", () => {
    expect(isPetAllowed(POLICY, CAT)).toBe(false);
  });

  it("isPetAllowed: bird not in allowed list → false", () => {
    expect(isPetAllowed(POLICY, BIRD)).toBe(false);
  });

  it("checkPetAdmission: dog admitted, bird rejected", () => {
    const result = checkPetAdmission(POLICY, [DOG, BIRD]);
    expect(result.admitted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it("checkPetAdmission: max pets enforcement", () => {
    const extra: PetRegistration = { ...DOG, petId: "p4", name: "Buddy" };
    const result = checkPetAdmission(POLICY, [DOG, extra, { ...DOG, petId: "p5", name: "Max" }]);
    expect(result.admitted).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
  });

  it("totalPetDeposit: 2 pets × 5000 = 10000", () => {
    expect(totalPetDeposit(POLICY, 2)).toBe(10000);
  });

  it("totalPetDeposit: capped at maxPetsAllowed", () => {
    expect(totalPetDeposit(POLICY, 5)).toBe(10000); // max 2 pets
  });
});
