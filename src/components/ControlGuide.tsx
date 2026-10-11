export function ControlGuide({ online }: { online: boolean }) {
  return (
    <section className="control-guide" aria-label="조작 가이드">
      <div className="keyboard-guide">
        <span><kbd>WASD</kbd> 이동</span><span><kbd>Space</kbd> 점프 / 매달림 점프</span>
        <span><kbd>Shift</kbd> 달리기</span><span><kbd>마우스</kbd> 시점 · <kbd>휠</kbd> 거리</span>
        <span><kbd>좌클릭 유지</kbd> 공중에서 발판 턱 잡기 · <kbd>W</kbd> 턱 올라가기</span>
        {online ? <span><kbd>E 유지</kbd> 팀원 구조</span> : <span><kbd>F</kbd> 능력 사용</span>}
        <span><kbd>C</kbd> 시점 초기화 · <kbd>Esc</kbd> 설정</span>
      </div>
      <div className="touch-guide">
        <span>이동 버튼 · 화면 드래그: 시점 · 점프 버튼: 점프 / 매달림 점프 · 잡기 유지: 등반{online ? ' / 구조' : ' · 능력 버튼'}</span>
      </div>
      <small>설정에서 가이드를 끌 수 있습니다</small>
    </section>
  )
}
