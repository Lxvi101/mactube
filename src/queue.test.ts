import { describe, expect, it } from "vitest";
import { freshVideoIds, parseRanges, recoverJobs } from "./queue";

describe("playlist range selection", () => {
  it("supports individual items, ranges, whitespace, and clipping", () => {
    expect([...parseRanges("1-3, 6, 9-20", 10)]).toEqual([0, 1, 2, 5, 8, 9]);
  });

  it("ignores malformed and zero-based entries", () => {
    expect([...parseRanges("nope, 0, 3", 5)]).toEqual([2]);
  });
});

describe("persistent queue recovery", () => {
  const base = {
    id: "job",
    sourceUrl: "https://example.com",
    info: {
      id: "video",
      title: "Video",
      uploader: "",
      duration: null,
      thumbnail: null,
      webpage_url: "https://example.com",
      playlist_title: null,
      playlist_index: null,
    },
    format: "video",
    quality: "best",
    progress: 72,
  };

  it("returns interrupted jobs to a safe waiting state", () => {
    const [job] = recoverJobs(
      JSON.stringify([{ ...base, status: "downloading", speed: "4 MB/s" }]),
    );
    expect(job.status).toBe("waiting");
    expect(job.progress).toBe(0);
    expect(job.speed).toBeUndefined();
  });

  it("drops completed jobs and corrupt data", () => {
    expect(
      recoverJobs(JSON.stringify([{ ...base, status: "complete" }])),
    ).toEqual([]);
    expect(recoverJobs("not-json")).toEqual([]);
  });
});

describe("duplicate detection", () => {
  it("excludes queued and previously downloaded videos", () => {
    expect(freshVideoIds(["a", "b", "c"], ["a"], ["c"])).toEqual(["b"]);
  });
});
