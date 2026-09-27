import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { managerOnboardingProfiles, careers } from "../db/schema";

export interface OnboardingInput {
  careerId: string;
  managerName: string;
  nationality?: string;
  tacticalPhilosophy: string;
  realismLevel: "STRICT_REALISM" | "REALISTIC" | "BALANCED" | "CASUAL" | "CHAOS";
  favFormations: string[];
  managerObjective: string;
  boardObjective: string;
  personalObjective: string;
}

export class OnboardingService {
  async getOnboardingProfile(careerId: string) {
    return db
      .select()
      .from(managerOnboardingProfiles)
      .where(eq(managerOnboardingProfiles.careerId, careerId))
      .get();
  }

  async saveOnboardingProfile(input: OnboardingInput): Promise<void> {
    const existing = await this.getOnboardingProfile(input.careerId);

    // Update career manager name if specified
    if (input.managerName) {
      await db
        .update(careers)
        .set({ managerName: input.managerName, updatedAt: new Date().toISOString() })
        .where(eq(careers.id, input.careerId));
    }

    if (existing) {
      await db
        .update(managerOnboardingProfiles)
        .set({
          nationality: input.nationality,
          tacticalPhilosophy: input.tacticalPhilosophy,
          realismLevel: input.realismLevel,
          favFormationsJson: JSON.stringify(input.favFormations),
          managerObjective: input.managerObjective,
          boardObjective: input.boardObjective,
          personalObjective: input.personalObjective,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(managerOnboardingProfiles.id, existing.id));
    } else {
      await db.insert(managerOnboardingProfiles).values({
        id: crypto.randomUUID(),
        careerId: input.careerId,
        nationality: input.nationality,
        tacticalPhilosophy: input.tacticalPhilosophy,
        realismLevel: input.realismLevel,
        favFormationsJson: JSON.stringify(input.favFormations),
        managerObjective: input.managerObjective,
        boardObjective: input.boardObjective,
        personalObjective: input.personalObjective,
        provenance: "USER",
      });
    }
  }
}