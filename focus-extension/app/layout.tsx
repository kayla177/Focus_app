import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Reuse your original extension CSS */}
        <link rel="stylesheet" href="./popup.css" />
        <link rel="stylesheet" href="./blocked.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
