// TxDOT emphasis area catalog. Column names from the HGAC crash
// FeatureServer (EA_01_Speed, etc.) are the stable ids. Labels
// drafted from column names — replace with official TxDOT names
// if they differ.
//
// Each crash row carries 0/1 flags for these columns. A crash
// can have zero or more EA tags (counts can sum > total when a
// crash carries multiple, or < total when some carry none).
//
// EA_LABELS is the source of truth; EA_IDS derives from its keys.
// Object.keys preserves insertion order, so EA_IDS comes back in
// the order the labels are written here.

export const EA_LABELS = {
  EA_01_Speed: 'Speed',
  EA_02_Impaired: 'Impaired Driving',
  EA_03_Distracted: 'Distracted Driving',
  EA_04_OccProt: 'Occupant Protection',
  EA_05_WrongWay: 'Wrong Way',
  EA_06_Young: 'Young Drivers',
  EA_07_Old: 'Older Drivers',
  EA_08_Ped: 'Pedestrians',
  EA_09_Bike: 'Bicyclists',
  EA_10_Motorcycle: 'Motorcycle',
  EA_11_Int: 'Intersections',
  EA_12_DepartRdwy: 'Depart Roadway',
  EA_13_DepartLn: 'Depart Lane',
  EA_14_Dark: 'Dark / Lighting',
} as const

export type EaFlagKey = keyof typeof EA_LABELS

export const EA_IDS = Object.keys(EA_LABELS) as EaFlagKey[]
