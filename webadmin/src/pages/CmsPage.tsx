import { useState } from "react";
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LANDING_PAGE_KINDS, type LandingPageKind } from "@roomadda/shared";
import { adminApi } from "../api/admin";
import { pushToast } from "../lib/toastBus";

/**
 * CMS + SEO Tools (§7.11). Manage the homepage featured order, blog (with SEO
 * title + meta), FAQs, testimonials, and city/area/intent/landmark landing copy
 * with per-page meta — no code deploy required. Functional over pixel-perfect.
 */
export function CmsPage() {
  const [tab, setTab] = useState(0);
  return (
    <>
      <Typography variant="h4" gutterBottom>
        CMS &amp; SEO
      </Typography>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Blog" />
        <Tab label="FAQs" />
        <Tab label="Testimonials" />
        <Tab label="Landing pages" />
        <Tab label="Homepage" />
      </Tabs>
      {tab === 0 && <BlogTab />}
      {tab === 1 && <FaqTab />}
      {tab === 2 && <TestimonialTab />}
      {tab === 3 && <LandingTab />}
      {tab === 4 && <HomepageTab />}
    </>
  );
}

function useInvalidate(key: string[]) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: key });
}

// ---- Blog ------------------------------------------------------------------
function BlogTab() {
  const invalidate = useInvalidate(["admin", "cms", "blog"]);
  const list = useQuery({ queryKey: ["admin", "cms", "blog"], queryFn: () => adminApi.listBlog(undefined, 50) });
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: (id: string) => adminApi.deleteBlog(id),
    onSuccess: () => {
      pushToast("Deleted", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const togglePublish = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => adminApi.updateBlog(id, { published }),
    onSuccess: () => {
      pushToast("Updated", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  return (
    <>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
        <Button variant="contained" onClick={() => setOpen(true)}>
          New post
        </Button>
      </Stack>
      <SimpleTable
        headers={["Title", "Slug", "Meta title", "Published", ""]}
        rows={list.data?.items ?? []}
        render={(p) => [
          p.title,
          p.slug,
          p.metaTitle ?? "—",
          <Chip key="c" size="small" color={p.published ? "success" : "default"} label={p.published ? "LIVE" : "DRAFT"} />,
          <Stack key="a" direction="row" spacing={1}>
            <Button size="small" onClick={() => togglePublish.mutate({ id: p.id, published: !p.published })}>
              {p.published ? "Unpublish" : "Publish"}
            </Button>
            <Button size="small" color="error" onClick={() => del.mutate(p.id)}>
              Delete
            </Button>
          </Stack>,
        ]}
      />
      {open && <BlogDialog onClose={() => setOpen(false)} onDone={invalidate} />}
    </>
  );
}

function BlogDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ slug: "", title: "", metaTitle: "", metaDescription: "", excerpt: "", body: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const create = useMutation({
    mutationFn: () => adminApi.createBlog(clean(f)),
    onSuccess: () => {
      pushToast("Created", "success");
      onDone();
      onClose();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  return (
    <FormDialog title="New blog post" onClose={onClose} onSubmit={() => create.mutate()} disabled={!f.slug || !f.title || create.isPending}>
      <TextField size="small" label="Slug (kebab-case)" value={f.slug} onChange={set("slug")} />
      <TextField size="small" label="Title" value={f.title} onChange={set("title")} />
      <TextField size="small" label="SEO meta title" value={f.metaTitle} onChange={set("metaTitle")} />
      <TextField size="small" label="SEO meta description" value={f.metaDescription} onChange={set("metaDescription")} multiline minRows={2} />
      <TextField size="small" label="Excerpt" value={f.excerpt} onChange={set("excerpt")} />
      <TextField size="small" label="Body" value={f.body} onChange={set("body")} multiline minRows={4} />
    </FormDialog>
  );
}

// ---- FAQ -------------------------------------------------------------------
function FaqTab() {
  const invalidate = useInvalidate(["admin", "cms", "faqs"]);
  const list = useQuery({ queryKey: ["admin", "cms", "faqs"], queryFn: () => adminApi.listFaqs() });
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: (id: string) => adminApi.deleteFaq(id),
    onSuccess: () => {
      pushToast("Deleted", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  return (
    <>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
        <Button variant="contained" onClick={() => setOpen(true)}>
          New FAQ
        </Button>
      </Stack>
      <SimpleTable
        headers={["Question", "Category", "Order", "Published", ""]}
        rows={list.data?.items ?? []}
        render={(q) => [
          q.question,
          q.category ?? "—",
          q.sortOrder,
          <Chip key="c" size="small" color={q.published ? "success" : "default"} label={q.published ? "LIVE" : "HIDDEN"} />,
          <Button key="d" size="small" color="error" onClick={() => del.mutate(q.id)}>
            Delete
          </Button>,
        ]}
      />
      {open && <FaqDialog onClose={() => setOpen(false)} onDone={invalidate} />}
    </>
  );
}

function FaqDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ question: "", answer: "", category: "", sortOrder: "0" });
  const create = useMutation({
    mutationFn: () =>
      adminApi.createFaq({ question: f.question, answer: f.answer, category: f.category || undefined, sortOrder: Number(f.sortOrder) || 0 }),
    onSuccess: () => {
      pushToast("Created", "success");
      onDone();
      onClose();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  return (
    <FormDialog title="New FAQ" onClose={onClose} onSubmit={() => create.mutate()} disabled={!f.question || !f.answer || create.isPending}>
      <TextField size="small" label="Question" value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} />
      <TextField size="small" label="Answer" value={f.answer} onChange={(e) => setF({ ...f, answer: e.target.value })} multiline minRows={3} />
      <TextField size="small" label="Category" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
      <TextField size="small" label="Sort order" type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} />
    </FormDialog>
  );
}

// ---- Testimonials ----------------------------------------------------------
function TestimonialTab() {
  const invalidate = useInvalidate(["admin", "cms", "testimonials"]);
  const list = useQuery({ queryKey: ["admin", "cms", "testimonials"], queryFn: () => adminApi.listTestimonials() });
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: (id: string) => adminApi.deleteTestimonial(id),
    onSuccess: () => {
      pushToast("Deleted", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  return (
    <>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
        <Button variant="contained" onClick={() => setOpen(true)}>
          New testimonial
        </Button>
      </Stack>
      <SimpleTable
        headers={["Author", "Quote", "Order", ""]}
        rows={list.data?.items ?? []}
        render={(t) => [
          `${t.authorName}${t.authorRole ? ` · ${t.authorRole}` : ""}`,
          t.quote,
          t.sortOrder,
          <Button key="d" size="small" color="error" onClick={() => del.mutate(t.id)}>
            Delete
          </Button>,
        ]}
      />
      {open && <TestimonialDialog onClose={() => setOpen(false)} onDone={invalidate} />}
    </>
  );
}

function TestimonialDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ authorName: "", authorRole: "", quote: "", sortOrder: "0" });
  const create = useMutation({
    mutationFn: () =>
      adminApi.createTestimonial({ authorName: f.authorName, authorRole: f.authorRole || undefined, quote: f.quote, sortOrder: Number(f.sortOrder) || 0 }),
    onSuccess: () => {
      pushToast("Created", "success");
      onDone();
      onClose();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  return (
    <FormDialog title="New testimonial" onClose={onClose} onSubmit={() => create.mutate()} disabled={!f.authorName || !f.quote || create.isPending}>
      <TextField size="small" label="Author name" value={f.authorName} onChange={(e) => setF({ ...f, authorName: e.target.value })} />
      <TextField size="small" label="Author role" value={f.authorRole} onChange={(e) => setF({ ...f, authorRole: e.target.value })} />
      <TextField size="small" label="Quote" value={f.quote} onChange={(e) => setF({ ...f, quote: e.target.value })} multiline minRows={3} />
      <TextField size="small" label="Sort order" type="number" value={f.sortOrder} onChange={(e) => setF({ ...f, sortOrder: e.target.value })} />
    </FormDialog>
  );
}

// ---- Landing pages ---------------------------------------------------------
function LandingTab() {
  const invalidate = useInvalidate(["admin", "cms", "landing"]);
  const list = useQuery({ queryKey: ["admin", "cms", "landing"], queryFn: () => adminApi.listLanding(undefined, 50) });
  const [open, setOpen] = useState(false);
  const del = useMutation({
    mutationFn: (id: string) => adminApi.deleteLanding(id),
    onSuccess: () => {
      pushToast("Deleted", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  const togglePublish = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => adminApi.updateLanding(id, { published }),
    onSuccess: () => {
      pushToast("Updated", "success");
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  return (
    <>
      <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
        <Button variant="contained" onClick={() => setOpen(true)}>
          New landing page
        </Button>
      </Stack>
      <SimpleTable
        headers={["Kind", "Slug", "Heading", "Meta title", "Published", ""]}
        rows={list.data?.items ?? []}
        render={(p) => [
          p.kind,
          p.slug,
          p.heading,
          p.metaTitle ?? "—",
          <Chip key="c" size="small" color={p.published ? "success" : "default"} label={p.published ? "LIVE" : "DRAFT"} />,
          <Stack key="a" direction="row" spacing={1}>
            <Button size="small" onClick={() => togglePublish.mutate({ id: p.id, published: !p.published })}>
              {p.published ? "Unpublish" : "Publish"}
            </Button>
            <Button size="small" color="error" onClick={() => del.mutate(p.id)}>
              Delete
            </Button>
          </Stack>,
        ]}
      />
      {open && <LandingDialog onClose={() => setOpen(false)} onDone={invalidate} />}
    </>
  );
}

function LandingDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    kind: "CITY" as LandingPageKind,
    slug: "",
    heading: "",
    bodyCopy: "",
    metaTitle: "",
    metaDescription: "",
    ogImageUrl: "",
    keywords: "",
  });
  const create = useMutation({
    mutationFn: () =>
      adminApi.createLanding({
        kind: f.kind,
        slug: f.slug,
        heading: f.heading,
        bodyCopy: f.bodyCopy || undefined,
        metaTitle: f.metaTitle || undefined,
        metaDescription: f.metaDescription || undefined,
        ogImageUrl: f.ogImageUrl || undefined,
        keywords: f.keywords ? f.keywords.split(",").map((k) => k.trim()).filter(Boolean) : undefined,
      }),
    onSuccess: () => {
      pushToast("Created", "success");
      onDone();
      onClose();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  return (
    <FormDialog title="New landing page" onClose={onClose} onSubmit={() => create.mutate()} disabled={!f.slug || !f.heading || create.isPending}>
      <TextField select size="small" label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as LandingPageKind })}>
        {LANDING_PAGE_KINDS.map((k) => (
          <MenuItem key={k} value={k}>
            {k}
          </MenuItem>
        ))}
      </TextField>
      <TextField size="small" label="Slug (kebab-case)" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} />
      <TextField size="small" label="Heading" value={f.heading} onChange={(e) => setF({ ...f, heading: e.target.value })} />
      <TextField size="small" label="Body copy" value={f.bodyCopy} onChange={(e) => setF({ ...f, bodyCopy: e.target.value })} multiline minRows={3} />
      <TextField size="small" label="Meta title" value={f.metaTitle} onChange={(e) => setF({ ...f, metaTitle: e.target.value })} />
      <TextField size="small" label="Meta description" value={f.metaDescription} onChange={(e) => setF({ ...f, metaDescription: e.target.value })} multiline minRows={2} />
      <TextField size="small" label="OG image URL" value={f.ogImageUrl} onChange={(e) => setF({ ...f, ogImageUrl: e.target.value })} />
      <TextField size="small" label="Keywords (comma-separated)" value={f.keywords} onChange={(e) => setF({ ...f, keywords: e.target.value })} />
    </FormDialog>
  );
}

// ---- Homepage featured order ----------------------------------------------
function HomepageTab() {
  const invalidate = useInvalidate(["admin", "cms", "homepage"]);
  const list = useQuery({ queryKey: ["admin", "cms", "homepage"], queryFn: () => adminApi.getHomepage() });
  const [ids, setIds] = useState<string | null>(null);
  const value = ids ?? (list.data?.items ?? []).map((i) => i.listingId).join("\n");
  const save = useMutation({
    mutationFn: () =>
      adminApi.setHomepage(
        value
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    onSuccess: () => {
      pushToast("Homepage order saved", "success");
      setIds(null);
      invalidate();
    },
    onError: (e: Error) => pushToast(e.message, "error"),
  });
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Homepage featured order
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        One listing ID per line, top-to-bottom. Saving replaces the whole ordering.
      </Typography>
      <TextField fullWidth multiline minRows={6} value={value} onChange={(e) => setIds(e.target.value)} sx={{ mb: 2, fontFamily: "monospace" }} />
      <Stack direction="row" spacing={1}>
        {(list.data?.items ?? []).map((i, idx) => (
          <Chip key={i.id} size="small" label={`${idx + 1}. ${i.alias ?? i.listingId.slice(0, 8)}`} />
        ))}
      </Stack>
      <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
        <Button variant="contained" onClick={() => save.mutate()} disabled={save.isPending}>
          Save order
        </Button>
      </Stack>
    </Paper>
  );
}

// ---- shared bits -----------------------------------------------------------
function clean(f: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));
}

function SimpleTable<T extends { id: string }>({
  headers,
  rows,
  render,
}: {
  headers: string[];
  rows: T[];
  render: (row: T) => React.ReactNode[];
}) {
  return (
    <Paper variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            {headers.map((h, i) => (
              <TableCell key={i}>{h}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={headers.length}>
                <Typography color="text.secondary" sx={{ py: 2 }}>
                  Nothing yet
                </Typography>
              </TableCell>
            </TableRow>
          )}
          {rows.map((row) => (
            <TableRow key={row.id} hover>
              {render(row).map((cell, i) => (
                <TableCell key={i}>{cell}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}

function FormDialog({
  title,
  children,
  onClose,
  onSubmit,
  disabled,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {children}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={onSubmit} disabled={disabled}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
