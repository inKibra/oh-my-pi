import { afterEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async";
import { snapshotJobs } from "@oh-my-pi/pi-coding-agent/async/job-control";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import * as evalIndex from "@oh-my-pi/pi-coding-agent/eval";
import * as bashExecutor from "@oh-my-pi/pi-coding-agent/exec/bash-executor";
import { buildAsyncResultBatchMessage } from "@oh-my-pi/pi-coding-agent/session/async-job-delivery";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { BashTool } from "@oh-my-pi/pi-coding-agent/tools/bash";
import { EvalTool } from "@oh-my-pi/pi-coding-agent/tools/eval";
import { TempDir } from "@oh-my-pi/pi-utils";

function sessionFor(root: string, manager: AsyncJobManager): ToolSession {
	return {
		cwd: root,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getArtifactsDir: () => path.join(root, "artifacts"),
		getSessionId: () => "job-started-at",
		asyncJobManager: manager,
		settings: Settings.isolated({
			"async.enabled": true,
			"bashInterceptor.enabled": false,
			"bash.autoBackground.enabled": false,
			"eval.autoBackground.enabled": true,
			"eval.autoBackground.thresholdMs": 0,
		}),
	};
}

afterEach(() => vi.restoreAllMocks());

describe("background job start time", () => {
	it("reports a bash job's start time in its details, job listing, and completion delivery", async () => {
		await using temp = await TempDir.create("@job-started-at-bash-");
		const manager = new AsyncJobManager({ onJobComplete: async () => {} });
		try {
			const gate = Promise.withResolvers<void>();
			vi.spyOn(bashExecutor, "executeBash").mockImplementation(async () => {
				await gate.promise;
				return {
					output: "done",
					exitCode: 0,
					cancelled: false,
					truncated: false,
					totalBytes: 4,
					totalLines: 1,
					outputBytes: 4,
					outputLines: 1,
				};
			});
			const result = await new BashTool(sessionFor(temp.path(), manager)).execute("bg", {
				command: "sleep 1",
				async: true,
			});
			const jobId = result.details?.async?.jobId;
			if (!jobId) throw new Error("Expected background job");
			const job = manager.getJob(jobId);
			if (!job) throw new Error("Expected registered job");

			expect(result.details?.async?.startedAt).toBe(job.startTime);
			expect(snapshotJobs(sessionFor(temp.path(), manager), [job])[0]?.startedAt).toBe(job.startTime);

			gate.resolve();
			await job.promise;
			expect((job.latestDetails?.async as { startedAt?: number } | undefined)?.startedAt).toBe(job.startTime);
			const delivery = buildAsyncResultBatchMessage([
				{ jobId, result: job.resultText ?? "", job, durationMs: 0, epoch: 0 },
			]);
			expect(delivery?.details?.jobs[0]?.startedAt).toBe(job.startTime);
		} finally {
			await manager.dispose();
		}
	});

	it("reports an auto-backgrounded eval job's start time in its details", async () => {
		await using temp = await TempDir.create("@job-started-at-eval-");
		const manager = new AsyncJobManager({ onJobComplete: async () => {} });
		try {
			const gate = Promise.withResolvers<void>();
			vi.spyOn(evalIndex.jsBackend, "execute").mockImplementation(async () => {
				await gate.promise;
				return {
					output: "done",
					exitCode: 0,
					cancelled: false,
					truncated: false,
					totalLines: 1,
					totalBytes: 4,
					outputLines: 1,
					outputBytes: 4,
					displayOutputs: [],
					artifactId: undefined,
				};
			});
			const result = await new EvalTool(sessionFor(temp.path(), manager)).execute("eval", {
				language: "js",
				code: "1",
			});
			const jobId = result.details?.async?.jobId;
			if (!jobId) throw new Error("Expected background eval");
			const job = manager.getJob(jobId);
			if (!job) throw new Error("Expected registered job");

			expect(result.details?.async?.startedAt).toBe(job.startTime);
			expect(snapshotJobs(sessionFor(temp.path(), manager), [job])[0]?.startedAt).toBe(job.startTime);

			gate.resolve();
			await job.promise;
			expect((job.latestDetails?.async as { startedAt?: number } | undefined)?.startedAt).toBe(job.startTime);
		} finally {
			await manager.dispose();
		}
	});
});
