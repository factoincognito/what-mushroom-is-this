import type { FindSummary, ListedFind } from "../store/find";
import { choiceFinds, choiceOffers, readChoiceFinds } from "./shareChoice";

const summary = (id: number): FindSummary => ({
  id,
  photoUri: `file:///photos/${id}.jpg`,
  time: { takenAtMs: 1_000 * id, utcOffsetMinutes: 60, source: "saved" },
  position: null,
  analysis: { state: "waiting" },
  answerBasis: null,
  selfCheck: null,
  species: null,
  picture: null,
});
const readable = (id: number): ListedFind => ({ readable: true, ...summary(id) });

describe("choiceFinds: the finds a shared photo can be added to (SPEC 3.9, Shared photos)", () => {
  it("lists the finds in the Library's order, each with whether it is full", () => {
    const finds = choiceFinds(
      [readable(3), readable(2), readable(1)],
      new Map([
        [3, 1],
        [2, 5],
        [1, 4],
      ]),
      5,
    );
    expect(finds.map(({ find, full }) => [find.id, full])).toEqual([
      [3, false],
      [2, true],
      [1, false],
    ]);
    expect(finds[0]?.find).toEqual(summary(3));
  });

  it("lists a text find without photos, which can get photos this way", () => {
    const text = { ...readable(4), photoUri: null };
    expect(choiceFinds([text], new Map([[4, 0]]), 5)).toEqual([
      { find: { ...summary(4), photoUri: null }, full: false },
    ]);
  });

  it("lists a find that holds more than the most as full", () => {
    expect(choiceFinds([readable(1)], new Map([[1, 6]]), 5)[0]?.full).toBe(true);
  });

  it("leaves out a find that could not be read, with or without an ID", () => {
    const entries: ListedFind[] = [
      { readable: false, id: 9 },
      readable(2),
      { readable: false, id: null, storedId: "0" },
    ];
    expect(choiceFinds(entries, new Map([[2, 1]]), 5).map(({ find }) => find.id)).toEqual([2]);
  });

  it("leaves out a find whose photos could not be counted", () => {
    expect(
      choiceFinds([readable(2), readable(1)], new Map([[1, 2]]), 5).map(({ find }) => find.id),
    ).toEqual([1]);
  });
});

describe("choiceOffers: what the choice offers", () => {
  const open = { find: summary(1), full: false };
  const full = { find: summary(2), full: true };

  it('offers "New find" and "Add to an earlier find" for one photo', () => {
    expect(choiceOffers(1, [open])).toEqual({ newFind: true, add: true });
  });

  it.each([2, 3, 5, 12])(
    'offers only "Add to an earlier find" for %d photos, never "New find"',
    (photos) => {
      expect(choiceOffers(photos, [open])).toEqual({ newFind: false, add: true });
    },
  );

  it('does not offer "Add to an earlier find" without a find', () => {
    expect(choiceOffers(1, [])).toEqual({ newFind: true, add: false });
    expect(choiceOffers(3, [])).toEqual({ newFind: false, add: false });
  });

  it('does not offer "Add to an earlier find" when every find is full', () => {
    expect(choiceOffers(1, [full])).toEqual({ newFind: true, add: false });
    expect(choiceOffers(2, [full, full])).toEqual({ newFind: false, add: false });
  });

  it("offers it when one find among full ones can be chosen", () => {
    expect(choiceOffers(2, [full, open])).toEqual({ newFind: false, add: true });
  });

  it("offers nothing for no photo", () => {
    expect(choiceOffers(0, [open])).toEqual({ newFind: false, add: false });
  });
});

describe("readChoiceFinds: reading the finds for the choice", () => {
  it("reads the list, and each find's photos to count them", async () => {
    const asked: number[] = [];
    const finds = await readChoiceFinds(
      {
        list: async () => [readable(3), { readable: false, id: 8 }, readable(1)],
        getStored: async (id) => {
          asked.push(id);
          return { photos: Array.from({ length: id === 3 ? 5 : 2 }, () => ({})) } as never;
        },
      },
      5,
    );
    expect(asked).toEqual([3, 1]);
    expect(finds.map(({ find, full }) => [find.id, full])).toEqual([
      [3, true],
      [1, false],
    ]);
  });

  it("leaves out a find that is gone or cannot be read when its photos are counted", async () => {
    const finds = await readChoiceFinds(
      {
        list: async () => [readable(3), readable(2), readable(1)],
        getStored: async (id) => {
          if (id === 3) {
            throw new Error("corrupt");
          }
          return id === 2 ? null : ({ photos: [{}] } as never);
        },
      },
      5,
    );
    expect(finds.map(({ find }) => find.id)).toEqual([1]);
  });

  it("fails when the list cannot be read", async () => {
    await expect(
      readChoiceFinds(
        {
          list: async () => {
            throw new Error("database is locked");
          },
          getStored: async () => null,
        },
        5,
      ),
    ).rejects.toThrow("database is locked");
  });
});
