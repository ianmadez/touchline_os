export interface PitchPositionSlot {
  slotIndex: number;
  role: string;
  label: string;
  top: number; // Percentage from top of 2D pitch
  left: number; // Percentage from left of 2D pitch
}

export interface FormationDefinition {
  id: string;
  name: string;
  category: "4-at-the-back" | "5-at-the-back" | "3-at-the-back";
  slots: PitchPositionSlot[];
}

export const FORMATIONS_REGISTRY: FormationDefinition[] = [
  // ==========================================
  // 4-AT-THE-BACK FORMATIONS
  // ==========================================
  {
    id: "4-3-3-holding",
    name: "4-3-3 Holding",
    category: "4-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "LB", label: "LB", top: 70, left: 16 },
      { slotIndex: 2, role: "CB", label: "LCB", top: 73, left: 38 },
      { slotIndex: 3, role: "CB", label: "RCB", top: 73, left: 62 },
      { slotIndex: 4, role: "RB", label: "RB", top: 70, left: 84 },
      { slotIndex: 5, role: "CDM", label: "CDM", top: 56, left: 50 },
      { slotIndex: 6, role: "CM", label: "LCM", top: 42, left: 35 },
      { slotIndex: 7, role: "CM", label: "RCM", top: 42, left: 65 },
      { slotIndex: 8, role: "LW", label: "LW", top: 22, left: 20 },
      { slotIndex: 9, role: "ST", label: "ST", top: 16, left: 50 },
      { slotIndex: 10, role: "RW", label: "RW", top: 22, left: 80 },
    ],
  },
  {
    id: "4-2-3-1-narrow",
    name: "4-2-3-1 Narrow",
    category: "4-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "LB", label: "LB", top: 70, left: 16 },
      { slotIndex: 2, role: "CB", label: "LCB", top: 73, left: 38 },
      { slotIndex: 3, role: "CB", label: "RCB", top: 73, left: 62 },
      { slotIndex: 4, role: "RB", label: "RB", top: 70, left: 84 },
      { slotIndex: 5, role: "CDM", label: "LDM", top: 58, left: 36 },
      { slotIndex: 6, role: "CDM", label: "RDM", top: 58, left: 64 },
      { slotIndex: 7, role: "LM", label: "LAM", top: 32, left: 24 },
      { slotIndex: 8, role: "CAM", label: "CAM", top: 30, left: 50 },
      { slotIndex: 9, role: "RM", label: "RAM", top: 32, left: 76 },
      { slotIndex: 10, role: "ST", label: "ST", top: 15, left: 50 },
    ],
  },
  {
    id: "4-4-2-flat",
    name: "4-4-2 Flat",
    category: "4-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "LB", label: "LB", top: 70, left: 16 },
      { slotIndex: 2, role: "CB", label: "LCB", top: 73, left: 38 },
      { slotIndex: 3, role: "CB", label: "RCB", top: 73, left: 62 },
      { slotIndex: 4, role: "RB", label: "RB", top: 70, left: 84 },
      { slotIndex: 5, role: "LM", label: "LM", top: 45, left: 18 },
      { slotIndex: 6, role: "CM", label: "LCM", top: 48, left: 38 },
      { slotIndex: 7, role: "CM", label: "RCM", top: 48, left: 62 },
      { slotIndex: 8, role: "RM", label: "RM", top: 45, left: 82 },
      { slotIndex: 9, role: "ST", label: "LST", top: 18, left: 38 },
      { slotIndex: 10, role: "ST", label: "RST", top: 18, left: 62 },
    ],
  },
  {
    id: "4-1-2-1-2-diamond",
    name: "4-1-2-1-2 Diamond",
    category: "4-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "LB", label: "LB", top: 70, left: 16 },
      { slotIndex: 2, role: "CB", label: "LCB", top: 73, left: 38 },
      { slotIndex: 3, role: "CB", label: "RCB", top: 73, left: 62 },
      { slotIndex: 4, role: "RB", label: "RB", top: 70, left: 84 },
      { slotIndex: 5, role: "CDM", label: "CDM", top: 58, left: 50 },
      { slotIndex: 6, role: "CM", label: "LCM", top: 44, left: 32 },
      { slotIndex: 7, role: "CM", label: "RCM", top: 44, left: 68 },
      { slotIndex: 8, role: "CAM", label: "CAM", top: 30, left: 50 },
      { slotIndex: 9, role: "ST", label: "LS", top: 16, left: 38 },
      { slotIndex: 10, role: "ST", label: "RS", top: 16, left: 62 },
    ],
  },
  {
    id: "4-3-2-1-tree",
    name: "4-3-2-1 Christmas Tree",
    category: "4-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "LB", label: "LB", top: 70, left: 16 },
      { slotIndex: 2, role: "CB", label: "LCB", top: 73, left: 38 },
      { slotIndex: 3, role: "CB", label: "RCB", top: 73, left: 62 },
      { slotIndex: 4, role: "RB", label: "RB", top: 70, left: 84 },
      { slotIndex: 5, role: "CM", label: "LCM", top: 50, left: 30 },
      { slotIndex: 6, role: "CM", label: "CCM", top: 52, left: 50 },
      { slotIndex: 7, role: "CM", label: "RCM", top: 50, left: 70 },
      { slotIndex: 8, role: "CAM", label: "LF", top: 30, left: 35 },
      { slotIndex: 9, role: "CAM", label: "RF", top: 30, left: 65 },
      { slotIndex: 10, role: "ST", label: "ST", top: 15, left: 50 },
    ],
  },

  // ==========================================
  // 5-AT-THE-BACK FORMATIONS
  // ==========================================
  {
    id: "5-3-2",
    name: "5-3-2",
    category: "5-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "LWB", label: "LWB", top: 62, left: 14 },
      { slotIndex: 2, role: "CB", label: "LCB", top: 73, left: 32 },
      { slotIndex: 3, role: "CB", label: "CCB", top: 75, left: 50 },
      { slotIndex: 4, role: "CB", label: "RCB", top: 73, left: 68 },
      { slotIndex: 5, role: "RWB", label: "RWB", top: 62, left: 86 },
      { slotIndex: 6, role: "CM", label: "LCM", top: 44, left: 32 },
      { slotIndex: 7, role: "CM", label: "CCM", top: 46, left: 50 },
      { slotIndex: 8, role: "CM", label: "RCM", top: 44, left: 68 },
      { slotIndex: 9, role: "ST", label: "LST", top: 18, left: 38 },
      { slotIndex: 10, role: "ST", label: "RST", top: 18, left: 62 },
    ],
  },
  {
    id: "5-2-3",
    name: "5-2-3",
    category: "5-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "LWB", label: "LWB", top: 62, left: 14 },
      { slotIndex: 2, role: "CB", label: "LCB", top: 73, left: 32 },
      { slotIndex: 3, role: "CB", label: "CCB", top: 75, left: 50 },
      { slotIndex: 4, role: "CB", label: "RCB", top: 73, left: 68 },
      { slotIndex: 5, role: "RWB", label: "RWB", top: 62, left: 86 },
      { slotIndex: 6, role: "CM", label: "LCM", top: 46, left: 38 },
      { slotIndex: 7, role: "CM", label: "RCM", top: 46, left: 62 },
      { slotIndex: 8, role: "LW", label: "LW", top: 22, left: 22 },
      { slotIndex: 9, role: "ST", label: "ST", top: 16, left: 50 },
      { slotIndex: 10, role: "RW", label: "RW", top: 22, left: 78 },
    ],
  },
  {
    id: "5-4-1-flat",
    name: "5-4-1 Flat",
    category: "5-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "LWB", label: "LWB", top: 62, left: 14 },
      { slotIndex: 2, role: "CB", label: "LCB", top: 73, left: 32 },
      { slotIndex: 3, role: "CB", label: "CCB", top: 75, left: 50 },
      { slotIndex: 4, role: "CB", label: "RCB", top: 73, left: 68 },
      { slotIndex: 5, role: "RWB", label: "RWB", top: 62, left: 86 },
      { slotIndex: 6, role: "LM", label: "LM", top: 42, left: 20 },
      { slotIndex: 7, role: "CM", label: "LCM", top: 45, left: 40 },
      { slotIndex: 8, role: "CM", label: "RCM", top: 45, left: 60 },
      { slotIndex: 9, role: "RM", label: "RM", top: 42, left: 80 },
      { slotIndex: 10, role: "ST", label: "ST", top: 16, left: 50 },
    ],
  },
  {
    id: "5-2-1-2",
    name: "5-2-1-2",
    category: "5-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "LWB", label: "LWB", top: 62, left: 14 },
      { slotIndex: 2, role: "CB", label: "LCB", top: 73, left: 32 },
      { slotIndex: 3, role: "CB", label: "CCB", top: 75, left: 50 },
      { slotIndex: 4, role: "CB", label: "RCB", top: 73, left: 68 },
      { slotIndex: 5, role: "RWB", label: "RWB", top: 62, left: 86 },
      { slotIndex: 6, role: "CM", label: "LCM", top: 48, left: 38 },
      { slotIndex: 7, role: "CM", label: "RCM", top: 48, left: 62 },
      { slotIndex: 8, role: "CAM", label: "CAM", top: 32, left: 50 },
      { slotIndex: 9, role: "ST", label: "LST", top: 16, left: 38 },
      { slotIndex: 10, role: "ST", label: "RST", top: 16, left: 62 },
    ],
  },

  // ==========================================
  // 3-AT-THE-BACK FORMATIONS
  // ==========================================
  {
    id: "3-5-2",
    name: "3-5-2",
    category: "3-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "CB", label: "LCB", top: 72, left: 28 },
      { slotIndex: 2, role: "CB", label: "CCB", top: 75, left: 50 },
      { slotIndex: 3, role: "CB", label: "RCB", top: 72, left: 72 },
      { slotIndex: 4, role: "LM", label: "LM", top: 48, left: 14 },
      { slotIndex: 5, role: "CDM", label: "LDM", top: 55, left: 38 },
      { slotIndex: 6, role: "CDM", label: "RDM", top: 55, left: 62 },
      { slotIndex: 7, role: "RM", label: "RM", top: 48, left: 86 },
      { slotIndex: 8, role: "CAM", label: "CAM", top: 34, left: 50 },
      { slotIndex: 9, role: "ST", label: "LST", top: 16, left: 38 },
      { slotIndex: 10, role: "ST", label: "RST", top: 16, left: 62 },
    ],
  },
  {
    id: "3-4-3",
    name: "3-4-3",
    category: "3-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "CB", label: "LCB", top: 72, left: 28 },
      { slotIndex: 2, role: "CB", label: "CCB", top: 75, left: 50 },
      { slotIndex: 3, role: "CB", label: "RCB", top: 72, left: 72 },
      { slotIndex: 4, role: "LM", label: "LM", top: 48, left: 16 },
      { slotIndex: 5, role: "CM", label: "LCM", top: 50, left: 38 },
      { slotIndex: 6, role: "CM", label: "RCM", top: 50, left: 62 },
      { slotIndex: 7, role: "RM", label: "RM", top: 48, left: 84 },
      { slotIndex: 8, role: "LW", label: "LW", top: 22, left: 22 },
      { slotIndex: 9, role: "ST", label: "ST", top: 16, left: 50 },
      { slotIndex: 10, role: "RW", label: "RW", top: 22, left: 78 },
    ],
  },
  {
    id: "3-4-1-2",
    name: "3-4-1-2",
    category: "3-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "CB", label: "LCB", top: 72, left: 28 },
      { slotIndex: 2, role: "CB", label: "CCB", top: 75, left: 50 },
      { slotIndex: 3, role: "CB", label: "RCB", top: 72, left: 72 },
      { slotIndex: 4, role: "LM", label: "LM", top: 48, left: 16 },
      { slotIndex: 5, role: "CM", label: "LCM", top: 52, left: 38 },
      { slotIndex: 6, role: "CM", label: "RCM", top: 52, left: 62 },
      { slotIndex: 7, role: "RM", label: "RM", top: 48, left: 84 },
      { slotIndex: 8, role: "CAM", label: "CAM", top: 32, left: 50 },
      { slotIndex: 9, role: "ST", label: "LST", top: 16, left: 38 },
      { slotIndex: 10, role: "ST", label: "RST", top: 16, left: 62 },
    ],
  },
  {
    id: "3-4-2-1",
    name: "3-4-2-1",
    category: "3-at-the-back",
    slots: [
      { slotIndex: 0, role: "GK", label: "GK", top: 86, left: 50 },
      { slotIndex: 1, role: "CB", label: "LCB", top: 72, left: 28 },
      { slotIndex: 2, role: "CB", label: "CCB", top: 75, left: 50 },
      { slotIndex: 3, role: "CB", label: "RCB", top: 72, left: 72 },
      { slotIndex: 4, role: "LM", label: "LM", top: 48, left: 16 },
      { slotIndex: 5, role: "CM", label: "LCM", top: 52, left: 38 },
      { slotIndex: 6, role: "CM", label: "RCM", top: 52, left: 62 },
      { slotIndex: 7, role: "RM", label: "RM", top: 48, left: 84 },
      { slotIndex: 8, role: "CAM", label: "LF", top: 28, left: 34 },
      { slotIndex: 9, role: "CAM", label: "RF", top: 28, left: 66 },
      { slotIndex: 10, role: "ST", label: "ST", top: 15, left: 50 },
    ],
  },
];

export function getFormationById(id: string): FormationDefinition {
  return (
    FORMATIONS_REGISTRY.find((f) => f.id === id) || FORMATIONS_REGISTRY[0]
  );
}