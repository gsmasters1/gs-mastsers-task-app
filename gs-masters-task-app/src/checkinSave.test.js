import { saveCheckinOrQueue, checkinSaveMessage } from "./checkinSave";

const row = { id: "ci-test", crew_id: "crew-1", job_id: "job-1" };

test("confirmed insert returns saved without queueing", async () => {
  const queue = jest.fn();
  const post = jest.fn().mockResolvedValue([{ id: row.id }]);
  expect(await saveCheckinOrQueue(row, post, queue)).toBe("saved");
  expect(post).toHaveBeenCalledWith("field_checkins", row);
  expect(queue).not.toHaveBeenCalled();
});

test("lost network queues the original record and makes status explicit", async () => {
  const queue = jest.fn();
  const post = jest.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  expect(await saveCheckinOrQueue(row, post, queue)).toBe("queued");
  expect(queue).toHaveBeenCalledWith({ table: "field_checkins", payload: row });
});

test.each([401, 403, 409, 422, 500])("HTTP %s is never quietly queued", async status => {
  const queue = jest.fn();
  const error = Object.assign(new Error("Rejected"), { status });
  await expect(saveCheckinOrQueue(row, jest.fn().mockRejectedValue(error), queue)).rejects.toBe(error);
  expect(queue).not.toHaveBeenCalled();
});

test("permission errors give crew actionable instructions in both languages", () => {
  expect(checkinSaveMessage({ status: 403 }, "en")).toMatch(/NOT checked in/i);
  expect(checkinSaveMessage({ status: 401 }, "es")).toMatch(/NO se registró/i);
});
