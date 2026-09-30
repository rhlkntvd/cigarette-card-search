export interface Card {
  dplaId: string;
  title: string;

  nyplUuid: string;

  frontImageId: string;
  backImageId?: string;

  sourceUrl: string;
  rights: string | null;
}
