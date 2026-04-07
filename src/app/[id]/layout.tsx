import { RoomProvider } from "@/app/context/RoomContext";

export default function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <nav>
      <h1>layout nè he</h1>
      <RoomProvider>
        {children}
      </RoomProvider>
    </nav>
  );
}
