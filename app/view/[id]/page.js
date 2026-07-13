import ViewClient from "@/components/ViewClient";

export default async function ViewPage({ params }) {
  const { id } = await params;
  return <ViewClient roomId={id} />;
}
