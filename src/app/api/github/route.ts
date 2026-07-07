import { NextResponse } from "next/server";
import { githubGraph } from "@/data/live";
import type { GitHubSnapshot } from "@/types";

const username = "ShiroKSH";

type GitHubUser = {
  public_repos?: number;
  followers?: number;
};

type GitHubRepo = {
  fork?: boolean;
  updated_at?: string;
};

type GitHubEvent = {
  type?: string;
  created_at?: string;
  payload?: {
    commits?: unknown[];
  };
};

function fallback(): GitHubSnapshot {
  return {
    ok: false,
    mode: "fallback",
    username,
    commits: 24,
    repositories: 7,
    followers: 1,
    lastPushAt: "2026-07-06T20:26:07Z",
    lastPushLabel: "today",
    graph: githubGraph,
  };
}

function daysAgoLabel(iso: string | null) {
  if (!iso) return "offline";
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta)) return "offline";
  const minutes = Math.max(1, Math.floor(delta / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function buildGraph(events: GitHubEvent[]) {
  const buckets = Array.from({ length: 63 }, () => 0);
  const now = new Date();

  events.forEach((event) => {
    if (event.type !== "PushEvent" || !event.created_at) return;
    const created = new Date(event.created_at);
    const days = Math.floor((now.getTime() - created.getTime()) / 86400000);
    if (days < 0 || days >= buckets.length) return;
    buckets[buckets.length - 1 - days] += event.payload?.commits?.length ?? 1;
  });

  return buckets.map((count) => {
    if (count === 0) return 0;
    if (count < 2) return 2;
    if (count < 4) return 4;
    if (count < 7) return 6;
    return 8;
  });
}

async function githubFetch<T>(path: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const response = await fetch(`https://api.github.com${path}`, {
    next: { revalidate: 900 },
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "user-agent": "kushida-tech",
      "x-github-api-version": "2022-11-28",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function GET() {
  try {
    const base = fallback();
    const [userResult, reposResult, eventsResult] = await Promise.allSettled([
      githubFetch<GitHubUser>(`/users/${username}`),
      githubFetch<GitHubRepo[]>(`/users/${username}/repos?per_page=100&sort=updated`),
      githubFetch<GitHubEvent[]>(`/users/${username}/events/public?per_page=100`),
    ]);

    const user = userResult.status === "fulfilled" ? userResult.value : {};
    const repos = reposResult.status === "fulfilled" ? reposResult.value : [];
    const events = eventsResult.status === "fulfilled" ? eventsResult.value : [];
    const pushEvents = events.filter((event) => event.type === "PushEvent");
    const commits = pushEvents.reduce(
      (total, event) => total + (event.payload?.commits?.length ?? 1),
      0,
    );
    const lastPushAt = pushEvents[0]?.created_at ?? repos[0]?.updated_at ?? base.lastPushAt;
    const ownRepos = repos.filter((repo) => !repo.fork).length || user.public_repos || repos.length || base.repositories;
    const hasAnyLiveData = userResult.status === "fulfilled" || reposResult.status === "fulfilled" || eventsResult.status === "fulfilled";

    return NextResponse.json({
      ok: hasAnyLiveData,
      mode: hasAnyLiveData ? "live" : "fallback",
      username,
      commits: commits || base.commits,
      repositories: ownRepos,
      followers: user.followers ?? base.followers,
      lastPushAt,
      lastPushLabel: daysAgoLabel(lastPushAt),
      graph: events.length ? buildGraph(events) : base.graph,
    } satisfies GitHubSnapshot);
  } catch {
    return NextResponse.json(fallback());
  }
}
