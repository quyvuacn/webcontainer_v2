import { describe, it, expect, vi } from "vitest";
import { terminateWorkerInSlot, type WorkerRefSlot } from "./run_node";

describe("terminateWorkerInSlot", () => {
  it("trả về false khi slot trống", () => {
    const slot: WorkerRefSlot = { current: null };
    expect(terminateWorkerInSlot(slot)).toBe(false);
  });

  it("trả về true khi có worker, slot.current thành null sau đó", () => {
    const slot: WorkerRefSlot = { current: null };
    const mockWorker = {
      worker: { terminate: vi.fn() } as unknown as Worker,
      resolve: vi.fn(),
      children: [] as Worker[],
    };
    slot.current = mockWorker;
    expect(terminateWorkerInSlot(slot)).toBe(true);
    expect(slot.current).toBeNull();
    expect(mockWorker.resolve).toHaveBeenCalledWith(130);
    expect(mockWorker.worker.terminate).toHaveBeenCalled();
  });

  it("terminate children trước khi terminate parent", () => {
    const child1 = { terminate: vi.fn() } as unknown as Worker;
    const child2 = { terminate: vi.fn() } as unknown as Worker;
    const slot: WorkerRefSlot = {
      current: {
        worker: { terminate: vi.fn() } as unknown as Worker,
        resolve: vi.fn(),
        children: [child1, child2],
      },
    };
    terminateWorkerInSlot(slot);
    expect(child1.terminate).toHaveBeenCalled();
    expect(child2.terminate).toHaveBeenCalled();
  });
});
