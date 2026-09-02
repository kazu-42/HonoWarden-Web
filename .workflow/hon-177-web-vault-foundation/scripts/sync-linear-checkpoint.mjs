import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workflowRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const checkpoint = process.argv[2] ?? "in-progress";
if (!["in-progress", "source-ready"].includes(checkpoint)) {
  throw new Error(`unsupported checkpoint: ${checkpoint}`);
}

const childIdentifier = "HON-177";
const parentIdentifier = "HON-176";
const marker = "<!-- honowarden-managed:HON-177:implementation-checkpoint -->";
const endpoint = "https://api.linear.app/graphql";
const apiKey = process.env.LINEAR_API_KEY?.trim();
const bodyPath = path.join(
  workflowRoot,
  `checkpoints/linear-${checkpoint}-checkpoint.md`,
);
const outputPath = path.join(
  workflowRoot,
  `results/linear-${checkpoint}-readback.json`,
);

if (!apiKey || [...apiKey].some(isControlCharacter)) {
  throw new Error("a valid LINEAR_API_KEY is required");
}

await mkdir(path.dirname(outputPath), { recursive: true });
const rawBody = await readFile(bodyPath, "utf8");
const body = rawBody.endsWith("\n") ? rawBody.slice(0, -1) : rawBody;
const before = await readIssues();
const inProgress = before.child.team.states.nodes.find(
  (state) => state.type === "started" && state.name === "In Progress",
);

if (!inProgress) {
  throw new Error("Linear In Progress state was not found");
}

for (const issue of [before.parent, before.child]) {
  if (!["backlog", "unstarted", "started"].includes(issue.state.type)) {
    throw new Error(
      `refusing to move ${issue.identifier} from ${issue.state.type}`,
    );
  }
  if (issue.archivedAt) {
    throw new Error(`refusing to update archived issue ${issue.identifier}`);
  }
}
if (before.child.parent?.identifier !== parentIdentifier) {
  throw new Error(
    `${childIdentifier} is no longer a child of ${parentIdentifier}`,
  );
}

const managedBefore = before.child.comments.nodes.filter((comment) =>
  comment.body?.startsWith(marker),
);
if (managedBefore.length > 1) {
  throw new Error(
    `duplicate managed HON-177 comments: ${managedBefore.length}`,
  );
}

for (const issue of [before.parent, before.child]) {
  if (issue.state.id !== inProgress.id) {
    const updated = await request(
      `mutation UpdateIssueState($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id identifier state { id name type } }
        }
      }`,
      { id: issue.id, input: { stateId: inProgress.id } },
    );
    if (!updated.issueUpdate?.success) {
      throw new Error(`Linear did not update ${issue.identifier} state`);
    }
  }
}

let commentId = managedBefore[0]?.id ?? null;
if (commentId) {
  const updated = await request(
    `mutation UpdateComment($id: String!, $input: CommentUpdateInput!) {
      commentUpdate(id: $id, input: $input) {
        success
        comment { id body updatedAt }
      }
    }`,
    { id: commentId, input: { body } },
  );
  if (!updated.commentUpdate?.success) {
    throw new Error("Linear did not update the managed HON-177 comment");
  }
} else {
  const created = await request(
    `mutation CreateComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment { id body updatedAt }
      }
    }`,
    { input: { issueId: before.child.id, body } },
  );
  if (!created.commentCreate?.success || !created.commentCreate.comment) {
    throw new Error("Linear did not create the managed HON-177 comment");
  }
  commentId = created.commentCreate.comment.id;
}

const after = await readIssues();
const managedAfter = after.child.comments.nodes.filter((comment) =>
  comment.body?.startsWith(marker),
);
const comment = managedAfter[0] ?? null;
const checks = {
  childState:
    after.child.state.id === inProgress.id &&
    after.child.state.type === "started",
  parentState:
    after.parent.state.id === inProgress.id &&
    after.parent.state.type === "started",
  parentRelation: after.child.parent?.identifier === parentIdentifier,
  unarchived: !after.child.archivedAt && !after.parent.archivedAt,
  singleManagedComment: managedAfter.length === 1,
  commentId: comment?.id === commentId,
  body: comment?.body === body,
  sha256: sha256(comment?.body ?? "") === sha256(body),
};
const errors = Object.entries(checks)
  .filter(([, passed]) => !passed)
  .map(([name]) => `${name} mismatch`);
const readback = {
  generatedAt: new Date().toISOString(),
  status: errors.length === 0 ? "exact" : "mismatch",
  child: {
    identifier: after.child.identifier,
    id: after.child.id,
    state: after.child.state,
  },
  parent: {
    identifier: after.parent.identifier,
    id: after.parent.id,
    state: after.parent.state,
  },
  commentId,
  commentUpdatedAt: comment?.updatedAt ?? null,
  bytes: Buffer.byteLength(body, "utf8"),
  sha256: sha256(body),
  checks,
  errors,
};

await writeFile(outputPath, `${JSON.stringify(readback, null, 2)}\n`);
console.log(JSON.stringify({ ...readback, output: outputPath }, null, 2));
if (errors.length > 0) {
  process.exitCode = 1;
}

async function readIssues() {
  const [child, parent] = await Promise.all([
    readIssue(childIdentifier),
    readIssue(parentIdentifier),
  ]);
  const comments = await readAllComments(child.id);
  return { child: { ...child, comments: { nodes: comments } }, parent };
}

async function readIssue(identifier) {
  const data = await request(
    `query ReadIssue($id: String!) {
      issue(id: $id) {
        id
        identifier
        archivedAt
        state { id name type }
        parent { identifier }
        team {
          id
          states(first: 100) { nodes { id name type } }
        }
      }
    }`,
    { id: identifier },
  );
  if (!data.issue || data.issue.identifier !== identifier) {
    throw new Error(`${identifier} was not found`);
  }
  return data.issue;
}

async function readAllComments(issueId) {
  const commentsById = new Map();
  const seenCursors = new Set();
  let after = null;

  for (let page = 0; page < 100; page += 1) {
    const data = await request(
      `query ReadIssueComments($id: String!, $after: String) {
        issue(id: $id) {
          comments(first: 100, after: $after) {
            nodes { id body updatedAt }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`,
      { id: issueId, after },
    );
    const connection = data.issue?.comments;
    if (!connection) {
      throw new Error(`comments were not found for issue ${issueId}`);
    }
    for (const comment of connection.nodes) {
      commentsById.set(comment.id, comment);
    }
    if (!connection.pageInfo.hasNextPage) {
      return [...commentsById.values()];
    }

    const nextCursor = connection.pageInfo.endCursor;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      throw new Error(`invalid Linear comment cursor for issue ${issueId}`);
    }
    seenCursors.add(nextCursor);
    after = nextCursor;
  }

  throw new Error(`refusing more than 100 comment pages for issue ${issueId}`);
}

async function request(query, variables) {
  const response = await globalThis.fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) {
    const messages = payload.errors?.map((error) => error.message) ?? [
      `HTTP ${response.status}`,
    ];
    throw new Error(`Linear checkpoint sync failed: ${messages.join("; ")}`);
  }
  return payload.data;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isControlCharacter(character) {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 31 || codePoint === 127;
}
