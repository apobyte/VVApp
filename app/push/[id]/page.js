import PushClient from "@/components/PushClient";

export default async function PushPage({ params }) {
  const { id } = await params;
  return <PushClient roomId={id} />;
}
