import { NextResponse } from "next/server";
const retired = () => NextResponse.json({ error: "워크스페이스 멤버 기능은 종료되었습니다. 페이지 또는 폴더의 공유 메뉴를 사용해주세요." }, { status: 410 });

export const GET = retired;
export const POST = retired;
export const DELETE = retired;
